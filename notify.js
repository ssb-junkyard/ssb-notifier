var notifications = require('freedesktop-notifications')
var pull = require('pull-stream')
var mlib = require('ssb-msgs')

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

module.exports = function (sbot, appName, cb) {
  notifications.init(function (err) {
    if (err) return cb(err)
    notifications.setAppName(appName)
    sbot.whoami(function (err, feed) {
      if (err) return cb(err)
      sbot.id = feed.id
      listenForNotifications(sbot, cb)
    })
  })
}

function decryptPrivateMessagess(sbot) {
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

function listenForNotifications(sbot, cb) {
  pull(
    sbot.createLogStream({
      live: true,
      reverse: true,
      gte: Date.now()
    }),
    pull.filter(function (msg) { return msg.sync === undefined }),
    decryptPrivateMessagess(sbot),
    pull.filter(function (msg) { return msg.value.content }),
    pull.asyncMap(function notify(msg, cb) {
      var c = msg.value.content
      switch (c && c.type) {

        case 'post':
          if (findLink(mlib.links(c.mentions), sbot.id)) {
            var subject = trimMessage(c.text) || 'a message'
            var author = getName(msg.value.author)
            return cb(null, {
              summary: author + ' mentioned you in ',
              body: subject
            })

          } else if (msg.private) {
            var author = getName(msg.value.author)
            return cb(null, {
              summary: author + ' sent you a private message',
              body: trimMessage(c.text)
            })
          }
          return cb()

        case 'contact':
          if (c.contact === sbot.id) {
            var name = getName(msg.value.author)
            var action =
              (c.following === true)  ? 'followed' :
              (c.blocking === true)   ? 'blocked' :
              (c.following === false) ? 'unfollowed' :
              '???'
            return cb(null, {
              summary: name + ' ' + action + ' you',
              body: subject
            })
          }
          return cb()

        case 'vote':
          var vote = c.vote
          if (typeof vote.value !== 'number')
            return cb()
          var msgLink = mlib.link(vote, 'msg')
          return sbot.get(msgLink.link, function (err, subject) {
            if (err) return cb(err)
            if (subject.author !== sbot.id) return cb()
            var author = getName(msg.value.author)
            var text = (subject && subject.content &&
              trimMessage(subject.content.text) || 'this message')
            var action =
              (vote.value > 0) ? 'dug' :
              (vote.value < 0) ? 'flagged' :
              'removed their vote for'
            var reason = vote.reason ? ' as ' + vote.reason : ''
            cb(null, {
              summary: author + ' ' + action + ' your message' + reason,
              body: text
            })
          })

        default:
          cb()
      }
    }),
    pull.drain(function (notif) {
      if (!notif) return
      notifications.createNotification(notif).push()
    }, function (err) {
      notifications.purge()
      cb(err)
    })
  )
}
