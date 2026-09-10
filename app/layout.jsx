import './globals.css'

export const metadata = {
  title: 'Private Family OS',
  description: 'A private, permissioned family memory layer.',
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
