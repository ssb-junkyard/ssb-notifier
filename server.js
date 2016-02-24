#!/bin/sh
':' //; exec "$(which nodejs || which node)" "$0" "$@"
// vi: ft=javascript

var path = require('path')
var ssbKeys = require('ssb-keys')
var appName = process.env.ssb_appname || 'ssb'
var conf = require('ssb-config/inject')(appName)

ssbKeys.loadOrCreate(path.join(conf.path, 'secret'), function (err, keys) {
  if (err) throw err
  require('ssb-client')(keys, conf, function (err, ssb) {
    if (err) throw err
    var keepalive = setInterval(ssb.whoami, 15e3)
    require('.')(ssb, appName, function (err) {
      console.log('ok')
      clearTimeout(keepalive)
      ssb.close(err, function (err) {
        console.log('closed')
        if (err) throw err
      })
    })
  })
})
