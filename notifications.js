var pull = require('pull-stream')
var mlib = require('ssb-msgs')
var multicb = require('multicb')

function truncate(str, len) {
  str = String(str)
  return str.length < len ? str : str.substr(0, len-1) + '…'
}

function getName(name) {
  // TODO: look up petname
  return truncate(name, 8)
}

function trimMessage(text) {
  return truncate(text, 140)
}

function decryptPrivateMessages(sbot) {
  return pull.asyncMap(function (msg, cb) {
    var content = msg.value && msg.value.content
    if (typeof content === 'string')
      sbot.private.unbox(content, function (err, content) {
        if (err) return cb(err)
        msg.value.content = content
        if (content)
          msg.private = true
        cb(null, msg)
      })
    else
      return cb(null, msg)
  })
}

function findLink(links, id) {
  for (var i = 0; i < (links ? links.length : 0); i++)
    if (links[i].link === id)
      return links[i]
}

function getMsgLink(sbot, content, cb) {
  var link = mlib.link(content, 'msg').link
  if (link) sbot.get(link, cb)
  else cb()
}

function makeUrl(msg) {
  return 'http://localhost:7777/#/msg/' + encodeURIComponent(msg.key)
}

// through stream to turn messages into notifications
module.exports = function (sbot, id) {
  return pull(
    pull.filter(function (msg) { return msg.sync === undefined }),
    decryptPrivateMessages(sbot),
    pull.asyncMap(function notify(msg, cb) {
      var c = msg.value.content
      if (!c || msg.value.author === id) return cb()

      switch (c.type) {
        case 'post':
          if (findLink(mlib.links(c.mentions), id)) {
            var subject = trimMessage(c.text) || 'a message'
            var author = getName(msg.value.author)
            return cb(null, {
              title: author + ' mentioned you in ',
              message: subject,
              open: makeUrl(msg)
            })

          } else if (msg.private) {
            var author = getName(msg.value.author)
            return cb(null, {
              title: author + ' sent you a private message',
              message: trimMessage(c.text),
              open: makeUrl(msg)
            })

          } else if (c.root || c.branch) {
            // check if this is a reply to one of our messages
            var done = multicb({ pluck: 1, spread: true })
            getMsgLink(sbot, c.root, done())
            getMsgLink(sbot, c.branch, done())
            done(function (err, root, branch) {
              if (err) return cb(err)
              var subject
              if (root && root.author === id)
                subject = 'your thread'
              else if (branch && branch.author === id)
                subject = 'your post'
              else
                return cb()
              var author = getName(msg.value.author)
              cb(null, {
                title: author + ' replied to ' + subject,
                message: trimMessage(c.text),
                open: makeUrl(msg)
              })
            })
          }
          return cb()

        case 'contact':
          if (c.contact === id) {
            var name = getName(msg.value.author)
            var action =
              (c.following === true)  ? 'followed' :
              (c.blocking === true)   ? 'blocked' :
              (c.following === false) ? 'unfollowed' :
              '???'
            return cb(null, {
              title: name + ' ' + action + ' you',
              message: subject,
              open: makeUrl(msg)
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
            if (err) return cb(err)
            if (subject.author !== id) return cb()
            var author = getName(msg.value.author)
            var text = (subject && subject.content &&
              trimMessage(subject.content.text) || 'this message')
            var action =
              (vote.value > 0) ? 'dug' :
              (vote.value < 0) ? 'flagged' :
              'removed their vote for'
            var reason = vote.reason ? ' as ' + vote.reason : ''
            cb(null, {
              title: author + ' ' + action + ' your message' + reason,
              message: text,
              open: makeUrl(msg)
            })
          })

        default:
          cb()
      }
    })
  )
}
