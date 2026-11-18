const { getDefaultConfig } = require('expo/metro-config')

const config = getDefaultConfig(__dirname)

// Giới hạn worker để tránh OOM khi bundle lớn
config.maxWorkers = 2

module.exports = config
