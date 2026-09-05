import { query } from '../db/client.js';

// The graph is a projection, not a second source of truth: this rebuilds it
// from assets/asset_relationships/findings/vulnerabilities every time it's
// called. Idempotent via ON CONFLICT upserts -- safe to call repeatedly
// (e.g. after every correlation run) without accumulating duplicate nodes
// or edges.
export async function syncSecurityGraph(orgId) {
  const { rows: assets } = await query('SELECT id, name, asset_type, criticality FROM assets WHERE org_id = $1', [orgId]);
  const assetNodeIds = new Map();

  for (const asset of assets) {
    const { rows } = await query(
      `INSERT INTO security_graph_nodes (org_id, node_type, ref_id, label, metadata)
       VALUES ($1, 'ASSET', $2, $3, $4)
       ON CONFLICT (org_id, node_type, ref_id) DO UPDATE SET label = $3, metadata = $4
       RETURNING id`,
      [orgId, asset.id, asset.name, JSON.stringify({ assetType: asset.asset_type, criticality: asset.criticality })]
    );
    assetNodeIds.set(asset.id, rows[0].id);
  }

  const { rows: relationships } = await query(
    'SELECT source_asset_id, target_asset_id, relationship_type FROM asset_relationships WHERE org_id = $1',
    [orgId]
  );
  for (const rel of relationships) {
    const sourceNodeId = assetNodeIds.get(rel.source_asset_id);
    const targetNodeId = assetNodeIds.get(rel.target_asset_id);
    if (!sourceNodeId || !targetNodeId) continue;
    await query(
      `INSERT INTO security_graph_edges (org_id, source_node_id, target_node_id, edge_type)
       VALUES ($1, $2, $3, $4) ON CONFLICT (org_id, source_node_id, target_node_id, edge_type) DO NOTHING`,
      [orgId, sourceNodeId, targetNodeId, rel.relationship_type]
    );
  }

  // Asset -[AFFECTED_BY]-> Vulnerability, derived from open findings whose
  // target matches one of the asset's own identifiers.
  const { rows: findings } = await query(
    `SELECT f.target, unnest(f.cve_ids) AS cve_id, f.risk_score
       FROM findings f
      WHERE f.org_id = $1 AND array_length(f.cve_ids, 1) > 0
        AND f.status NOT IN ('FALSE_POSITIVE', 'VERIFIED_FIXED')`,
    [orgId]
  );
  const vulnNodeIds = new Map();

  for (const finding of findings) {
    const { rows: matchedAssets } = await query(
      `SELECT a.id FROM assets a JOIN asset_identifiers ai ON ai.asset_id = a.id
        WHERE a.org_id = $1 AND ai.value = $2`,
      [orgId, finding.target]
    );
    if (matchedAssets.length === 0) continue;

    if (!vulnNodeIds.has(finding.cve_id)) {
      const { rows } = await query(
        `INSERT INTO security_graph_nodes (org_id, node_type, ref_id, label, metadata)
         VALUES ($1, 'VULNERABILITY', $2, $2, '{}')
         ON CONFLICT (org_id, node_type, ref_id) DO UPDATE SET label = $2
         RETURNING id`,
        [orgId, finding.cve_id]
      );
      vulnNodeIds.set(finding.cve_id, rows[0].id);
    }
    const vulnNodeId = vulnNodeIds.get(finding.cve_id);

    for (const assetRow of matchedAssets) {
      const assetNodeId = assetNodeIds.get(assetRow.id);
      if (!assetNodeId) continue;
      await query(
        `INSERT INTO security_graph_edges (org_id, source_node_id, target_node_id, edge_type, metadata)
         VALUES ($1, $2, $3, 'AFFECTED_BY', $4)
         ON CONFLICT (org_id, source_node_id, target_node_id, edge_type) DO UPDATE SET metadata = $4`,
        [orgId, assetNodeId, vulnNodeId, JSON.stringify({ riskScore: finding.risk_score })]
      );
    }
  }

  return { assetNodes: assetNodeIds.size, vulnerabilityNodes: vulnNodeIds.size, edges: relationships.length };
}

// Defensive attack-path analysis (spec section 31): "a vulnerability here --
// which critical systems could it affect indirectly?" BFS outward from the
// affected asset following structural edges only (HOSTS/DEPENDS_ON/
// CONNECTS_TO/CONTAINS/RUNS/EXPOSES) -- AFFECTED_BY edges are the leaves
// being asked about, not something to traverse further through.
const STRUCTURAL_EDGE_TYPES = new Set(['HOSTS', 'DEPENDS_ON', 'CONNECTS_TO', 'CONTAINS', 'RUNS', 'EXPOSES']);

// Shared read of the graph's structural adjacency + every ASSET node's
// identity/criticality, for anything that needs to walk the graph itself
// rather than ask a single reachability question (securityGraphOptimizer.js).
// Kept separate from findReachableAssets below so that function's existing
// callers/behavior are untouched.
export async function loadStructuralGraph(orgId) {
  const { rows: nodes } = await query(
    `SELECT n.id, n.ref_id AS asset_id, n.label, a.criticality
       FROM security_graph_nodes n
       JOIN assets a ON a.id = n.ref_id::uuid
      WHERE n.org_id = $1 AND n.node_type = 'ASSET'`,
    [orgId]
  );
  const nodesById = new Map(nodes.map((n) => [n.id, n]));

  const { rows: edges } = await query(
    'SELECT source_node_id, target_node_id, edge_type FROM security_graph_edges WHERE org_id = $1',
    [orgId]
  );
  const adjacency = new Map();
  for (const edge of edges) {
    if (!STRUCTURAL_EDGE_TYPES.has(edge.edge_type)) continue;
    if (!adjacency.has(edge.source_node_id)) adjacency.set(edge.source_node_id, []);
    adjacency.get(edge.source_node_id).push(edge.target_node_id);
  }

  // Asset -[AFFECTED_BY]-> Vulnerability edges, resolved back to the asset
  // node and the CVE label -- the entry points an attack-path analysis
  // starts from.
  const { rows: vulnEdges } = await query(
    `SELECT e.source_node_id AS asset_node_id, v.label AS cve_id, (e.metadata->>'riskScore')::numeric AS risk_score
       FROM security_graph_edges e
       JOIN security_graph_nodes v ON v.id = e.target_node_id AND v.node_type = 'VULNERABILITY'
      WHERE e.org_id = $1 AND e.edge_type = 'AFFECTED_BY'`,
    [orgId]
  );

  return { nodesById, adjacency, vulnEdges };
}

export async function findReachableAssets(orgId, startAssetId) {
  const { rows: startNodeRows } = await query(
    "SELECT id FROM security_graph_nodes WHERE org_id = $1 AND node_type = 'ASSET' AND ref_id = $2",
    [orgId, startAssetId]
  );
  if (startNodeRows.length === 0) return [];
  const startNodeId = startNodeRows[0].id;

  const { rows: edges } = await query(
    `SELECT source_node_id, target_node_id, edge_type FROM security_graph_edges WHERE org_id = $1`,
    [orgId]
  );

  const adjacency = new Map();
  for (const edge of edges) {
    if (!STRUCTURAL_EDGE_TYPES.has(edge.edge_type)) continue;
    if (!adjacency.has(edge.source_node_id)) adjacency.set(edge.source_node_id, []);
    adjacency.get(edge.source_node_id).push(edge.target_node_id);
  }

  const visited = new Set([startNodeId]);
  const queue = [startNodeId];
  while (queue.length > 0) {
    const current = queue.shift();
    for (const next of adjacency.get(current) || []) {
      if (!visited.has(next)) {
        visited.add(next);
        queue.push(next);
      }
    }
  }
  visited.delete(startNodeId);
  if (visited.size === 0) return [];

  const { rows: reachable } = await query(
    `SELECT n.ref_id AS asset_id, n.label, a.criticality
       FROM security_graph_nodes n
       JOIN assets a ON a.id = n.ref_id::uuid
      WHERE n.id = ANY($1) AND n.node_type = 'ASSET'`,
    [[...visited]]
  );
  return reachable;
}
