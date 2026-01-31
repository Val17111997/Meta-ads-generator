import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Meta Ads Generator - Gemini AI',
  description: 'Générateur automatique de créatives Meta Ads avec Google Gemini',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  )
}
