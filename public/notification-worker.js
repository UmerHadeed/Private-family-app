self.addEventListener('push', event => {
  let data = {}
  try { data = event.data ? event.data.json() : {} } catch { data = { title: 'Private Family OS', body: 'You have a new private update.' } }
  const title = data.title || 'Private Family OS'
  const options = {
    body: data.body || 'You have a new private update.',
    icon: '/favicon.ico',
    badge: '/favicon.ico',
    data: { url: data.url || '/' }
  }
  event.waitUntil(self.registration.showNotification(title, options))
})
self.addEventListener('notificationclick', event => {
  event.notification.close()
  event.waitUntil(clients.openWindow(event.notification.data?.url || '/'))
})
