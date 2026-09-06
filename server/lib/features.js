// Centralized feature list for quantum parameters
const FEATURES = {
  DOS: 'dos',
  FUZZ: 'fuzz',
  INTRUSIVE: 'intrusive'
};

const ALLOWED_FEATURES = Object.values(FEATURES);

module.exports = { FEATURES, ALLOWED_FEATURES };
