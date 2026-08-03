/**
 * Resolves the (command, args) to spawn for a quantum worker call:
 * `python3 <script.py>` (PYTHON_BIN overridable for local dev setups with a
 * differently-named interpreter).
 */
export function resolveQuantumCommand(_mode, scriptPath) {
  const pythonBin = process.env.PYTHON_BIN || 'python3';
  return { bin: pythonBin, args: [scriptPath] };
}
