'use strict'
var pull = require('pull-stream')
var mlib = require('ssb-msgs')
var multicb = require('multicb')
var cat = require('pull-cat')
var fs = require('fs')
var os = require('os')
var http = require('http')
var path = require('path')
var toPull = require('stream-to-pull-stream')

function truncate(str, len) {
  str = String(str)
  return str.length < len ? str : str.substr(0, len-1) + '…'
}

function trimMessage(text) {
  return truncate(text, 140)
}

function decryptPrivateMessages(sbot) {
  return pull.asyncMap(function (msg, cb) {
    var content = msg && msg.value && msg.value.content
    if (typeof content === 'string')
      sbot.private.unbox(content, function (err, content) {
        if (err) throw err
        return cb(null, {
          key: msg.key,
          private: true,
          value: {
            content: content,
            author: msg.value.author
          }
        })
      })
    else
      cb(null, msg)
  })
}

function findLink(links, id) {
  for (var i = 0; i < (links ? links.length : 0); i++)
    if (links[i].link === id)
      return links[i]
}

function getMsgLink(sbot, content, cb) {
  var link = mlib.link(content, 'msg')
  if (link) sbot.get(link.link, cb)
  else cb()
}

function makeUrl(msg) {
  return 'http://localhost:7777/#/msg/' + encodeURIComponent(msg.key)
}

// Get filename for a blob
function getBlobFile(sbot, id, cb) {
  var fileName = path.join(os.tmpdir(), id)
  fs.exists(fileName, function (exists) {
    if (exists) return cb(fileName)
    sbot.blobs.want(id, function (err, has) {
      if (!has) return cb()
      pull(
        sbot.blobs.get(id),
        toPull.sink(fs.createWriteStream(fileName), function (err) {
          cb(!err && fileName)
        })
      )
    })
  })
}

// Fetch a file from Patchwork
function fetch(path, dest, cb) {
  fs.exists(dest, function (exists) {
    if (exists) return cb(dest)
    http.request('http://localhost:7777/' + path, function (res) {
      res.pipe(fs.createWriteStream(dest)).on('close', function () {
        cb(dest)
      })
    }).on('error', function () {
      cb()
    }).end()
  })
}

// Write a Patchwork icon to a file
function getDefaultIcon(cb) {
  fetch('img/icon.png', path.join(os.tmpdir(), 'patchwork-icon.png'), cb)
}

// Get About info for a feed.
function getAbout(sbot, source, dest, cb) {
  var name, image
  pull(
    cat([
      // First get About info that we gave them.
      sbot.links({
        source: source,
        dest: dest,
        rel: 'about',
        values: true,
        reverse: true
      }),
      // If that isn't enough, then get About info that they gave themselves.
      sbot.links({
        source: dest,
        dest: dest,
        rel: 'about',
        values: true,
        reverse: true
      }),
    ]),
    pull.filter(function (msg) {
      return msg && msg.value.content && (!name || !image)
    }),
    pull.drain(function (msg) {
      var c = msg.value.content
      if (!name) {
        name = c.name
      }
      if (!image) {
        var imgLink = mlib.link(c.image, 'blob')
        image = imgLink && imgLink.link
      }
    }, function (err) {
      if (err) return cb (err)
      if (!name) name = truncate(dest, 8)
      if (!image) gotImage()
      else getBlobFile(sbot, image, gotImage)
      function gotImage(path) {
        if (!path) getDefaultIcon(gotImage2)
        else gotImage2(path)
      }
      function gotImage2(path) {
        cb(null, name, path)
      }
    })
  )
}

// through stream to turn messages into notifications
module.exports = function (sbot, myId) {

  var about = {}
  // get name and icon for a user
  function getAboutCached(id, cb) {
    if (id in about)
      return cb(null, about[id])
    getAbout(sbot, myId, id, function (err, name, image) {
      cb(null, about[id] = {name: name, image: image})
    })
  }

  return pull(
    pull.filter(function (msg) { return msg.sync === undefined }),
    decryptPrivateMessages(sbot),
    pull.asyncMap(function (msg, cb) {
      var c = msg && msg.value && msg.value.content
      if (!c || typeof c != 'object') return cb()

      if (msg.value.author === myId) {
        if (c.type == 'about' && c.about in about) {
          if (c.name) {
            // update our name for someone
            about[c.about].name = c.name
          }
          if (c.image) {
            // image is more expensive to update. just invalidate the cache
            delete about[c.about]
          }
        }
        return cb()
      }

      switch (c.type) {
        case 'post':
          if (findLink(mlib.links(c.mentions), myId)) {
            var subject = trimMessage(c.text) || 'a message'
            return getAboutCached(msg.value.author, function (err, about) {
              cb(err, {
                icon: about.image,
                title: about.name + ' mentioned you',
                message: subject,
                open: makeUrl(msg)
              })
            })

          } else if (msg.private) {
            return getAboutCached(msg.value.author, function (err, about) {
              if (err) return cb(err)
              cb(null, {
                icon: about.image,
                title: about.name + ' sent you a private message',
                message: trimMessage(c.text),
                open: makeUrl(msg)
              })
            })

          } else if (c.root || c.branch) {
            // check if this is a reply to one of our messages
            var done = multicb({ pluck: 1, spread: true })
            getMsgLink(sbot, c.root, done())
            getMsgLink(sbot, c.branch, done())
            return done(function (err, root, branch) {
              if (err) return cb(err)
              var subject
              if (root && root.author === myId)
                subject = 'your thread'
              else if (branch && branch.author === myId)
                subject = 'your post'
              else
                return cb()
              getAboutCached(msg.value.author, function (err, about) {
                if (err) return cb(err)
                cb(null, {
                  icon: about.image,
                  title: about.name + ' replied to ' + subject,
                  message: trimMessage(c.text),
                  open: makeUrl(msg)
                })
              })
            })
          }
          return cb()

        case 'contact':
          if (c.contact === myId) {
            return getAboutCached(msg.value.author, function (err, about) {
              if (err) return cb(err)
              var action =
                (c.following === true)  ? 'followed' :
                (c.blocking === true)   ? 'blocked' :
                (c.following === false) ? 'unfollowed' :
                '???'
              cb(null, {
                icon: about.image,
                title: about.name + ' ' + action + ' you',
                open: makeUrl(msg)
              })
            })
          }
          return cb()

        case 'vote':
          var vote = c.vote
          if (typeof vote.value !== 'number')
            return cb()
          var msgLink = mlib.link(vote, 'msg')
          if (!msgLink) return cb()
          return sbot.get(msgLink.link, function (err, subject) {
            if (err) {
              if (err.name == 'NotFoundError') return cb()
              else return cb(err)
            }
            if (!subject || subject.author !== myId) return cb()
            getAboutCached(msg.value.author, function (err, about) {
              if (err) return cb(err)
              var text = (subject.content &&
                trimMessage(subject.content.text) || 'this message')
              var action =
                (vote.value > 0) ? 'dug' :
                (vote.value < 0) ? 'flagged' :
                'removed their vote for'
              var reason = vote.reason ? ' as ' + vote.reason : ''
              cb(null, {
                icon: about.image,
                title: about.name + ' ' + action + ' your message' + reason,
                message: text,
                open: makeUrl(msg)
              })
            })
          })

        default:
          cb()
      }
    }),
    pull.filter(Boolean)
  )
}
