const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Add this to help Metro resolve packages with modern "exports"
config.resolver.resolverMainFields = ['react-native', 'browser', 'main'];

module.exports = config;