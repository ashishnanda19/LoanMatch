// Variable file for serverless.yml. Serverless cannot turn an environment variable into a list by itself,
// so the subnet ids (comma-separated, from scripts/serverless_env.sh) are split here.
module.exports.subnetIds = () => (process.env.TF_SUBNET_IDS || '').split(',').map((s) => s.trim()).filter(Boolean);
