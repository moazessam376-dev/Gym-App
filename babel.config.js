module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    // react-native-worklets/plugin powers Reanimated 4 (worklets were split out of
    // the reanimated package in v4). It MUST be listed last. Without it, Reanimated
    // animations silently no-op or crash.
    plugins: ['react-native-worklets/plugin'],
  };
};
