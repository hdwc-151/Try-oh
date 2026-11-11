// Public build configuration. Secrets belong on the backend, never in extra.
module.exports = ({ config }) => {
  const projectId = process.env.EXPO_PROJECT_ID?.trim() || config.extra?.eas?.projectId;
  const owner = process.env.EXPO_ACCOUNT_OWNER?.trim();
  if (process.env.EAS_BUILD === 'true' && !projectId) {
    throw new Error('Set EXPO_PROJECT_ID to your own EAS project before building Try-oh.');
  }
  return {
    ...config,
    ...(owner ? { owner } : {}),
    extra: {
      ...config.extra,
      ...(projectId ? { eas: { projectId } } : {}),
    },
  };
};
