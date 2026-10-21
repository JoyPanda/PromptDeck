import { render } from '@gpuix/react'
import { App } from './app'
import { dispatchKeyCapture } from './hotkey/capture'
import { installWindowsIcon } from './window/win-icon'

render(<App />, {
  title: 'PromptDeck',
  appName: 'PromptDeck',
  width: 1120,
  height: 760,
  minWidth: 880,
  minHeight: 640,
  focus: process.env.GPUIX_BACKGROUND !== '1',
  onKeyDown: (event) => dispatchKeyCapture(event),
})

installWindowsIcon()
