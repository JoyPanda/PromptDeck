import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { StyleDesc } from '@gpuix/react'
import { DEFAULT_FONT_SIZE, defaultFontFamily, type Appearance } from '../settings'
import { readSystemDark, watchSystemAppearance } from './appearance'

export type Palette = {
  bg: string
  sidebar: string
  panel: string
  card: string
  line: string
  text: string
  muted: string
  faint: string
  accent: string
  accentText: string
  accentHover: string
  danger: string
  dangerBg: string
  dangerHover: string
  hover: string
  press: string
  accentPress: string
  dangerPress: string
  selectedPress: string
  selected: string
  input: string
  font: string
}

const font = defaultFontFamily()

export const darkPalette: Palette = {
  bg: '#1e1e1e',
  sidebar: '#252526',
  panel: '#2d2d2d',
  card: '#333333',
  line: '#3c3c3c',
  text: '#e6e6e6',
  muted: '#9d9d9d',
  faint: '#6f6f6f',
  accent: '#4c8dff',
  accentText: '#ffffff',
  accentHover: '#6aa1ff',
  danger: '#f14c4c',
  dangerBg: '#3a2424',
  dangerHover: '#4a2e2e',
  hover: '#3a3a3a',
  press: '#2a2a2a',
  accentPress: '#2f6fd6',
  dangerPress: '#5c3030',
  selectedPress: '#0c5c94',
  selected: '#094771',
  input: '#1e1e1e',
  font,
}

export const lightPalette: Palette = {
  bg: '#f3f3f3',
  sidebar: '#f8f8f8',
  panel: '#ffffff',
  card: '#ffffff',
  line: '#e0e0e0',
  text: '#1f1f1f',
  muted: '#616161',
  faint: '#8a8a8a',
  accent: '#0066cc',
  accentText: '#ffffff',
  accentHover: '#1a75d1',
  danger: '#c42b1c',
  dangerBg: '#fdecea',
  dangerHover: '#f8d7d3',
  hover: '#e8e8e8',
  press: '#d6d6d6',
  accentPress: '#0052a3',
  dangerPress: '#f6c9c4',
  selectedPress: '#b5d8f3',
  selected: '#cce4f7',
  input: '#ffffff',
  font,
}

type ThemeValue = {
  palette: Palette
  resolved: 'dark' | 'light'
  fontSize: number
}

const ThemeContext = createContext<ThemeValue>({ palette: darkPalette, resolved: 'dark', fontSize: DEFAULT_FONT_SIZE })

export function scaleFont(size: number, fontSize = DEFAULT_FONT_SIZE): number {
  return Math.max(1, Math.round((size * fontSize) / DEFAULT_FONT_SIZE))
}

export function ThemeProvider({
  appearance,
  fontFamily,
  fontSize,
  children,
}: {
  appearance: Appearance
  fontFamily: string
  fontSize: number
  children: ReactNode
}) {
  const [systemDark, setSystemDark] = useState(readSystemDark)
  useEffect(() => {
    if (appearance !== 'system') return
    return watchSystemAppearance(setSystemDark)
  }, [appearance])
  const resolved = appearance === 'system' ? (systemDark ? 'dark' : 'light') : appearance
  const base = resolved === 'dark' ? darkPalette : lightPalette
  const palette = base.font === fontFamily ? base : { ...base, font: fontFamily }
  return <ThemeContext.Provider value={{ palette, resolved, fontSize }}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeValue {
  return useContext(ThemeContext)
}

export function textStyle(color: string, size = 12, weight?: string, family = font): StyleDesc {
  return {
    color,
    fontSize: size,
    fontFamily: family,
    ...(weight ? { fontWeight: weight } : {}),
  }
}
