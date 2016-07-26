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
var getAbout = require('ssb-avatar')

var defaultIcon = '&qjeAs8+uMXLlyovT4JnEpMwTNDx/QXHfOl2nv2u0VCM=.sha256'

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
  var fileName = path.join(os.tmpdir(), encodeURIComponent(id))
  fs.exists(fileName, function (exists) {
    if (exists) return cb(null, fileName)
    sbot.blobs.want(id, function (err, has) {
      if (err) cb(err)
      else if (!has) cb()
      else pull(
        sbot.blobs.get(id),
        toPull.sink(fs.createWriteStream(fileName), function (err) {
          cb(err, fileName)
        })
      )
    })
  })
}

// Get a name for a thing from multiple fallback sources
function getName(sbot, sources, dest, cb) {
  var name
  pull(
    cat(sources.map(function (source) {
      return sbot.links({
        source: source,
        dest: dest,
        rel: 'about',
        values: true,
        keys: false,
        meta: false,
        reverse: true
      })
    })),
    pull.drain(function (link) {
      name = msg.value.content.name
      if (name) return false
    }, function (err) {
      cb(err, name)
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
    getAbout(sbot, myId, id, function (err, about) {
      if (err) return cb(err)
      getBlobFile(sbot, about.image || defaultIcon, function (err, path) {
        if (err) return cb(err)
        cb(null, about[id] = {name: name, image: path})
      })
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

        case 'pull-request':
        case 'issue':
          return sbot.get(c.repo || c.project, function (err, repo) {
            if (err) return cb(err)
            if (repo.author !== myId) return cb()
            var done = multicb({ pluck: 1, spread: true })
            getAboutCached(msg.value.author, done())
            getName(sbot, [myId, msg.value.author, null], c.repo, done())
            done(function (err, author, repoName) {
              if (err) return cb(err)
              var what = c.type === 'issue' ? 'an issue' : 'a pull request'
              var dest = repoName || truncate(c.repo, 16)
              cb(null, {
                icon: author.image,
                title: author.name + ' opened ' + what + ' on ' + dest,
                message: trimMessage(c.text),
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
