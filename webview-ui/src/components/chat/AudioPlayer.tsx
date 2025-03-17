import { useEffect } from "react"
import { useEvent } from "react-use"

/**
 * AudioPlayer component that listens for audio messages from the extension
 * and plays them using the Web Audio API
 */
const AudioPlayer = () => {
  // Handle audio messages from the extension
  const handleMessage = (event: MessageEvent) => {
    const message = event.data
    if (message.type === "playAudio" && message.text) {
      // Create an audio element and play the audio
      const audio = new Audio(message.text)
      audio.play().catch(error => {
        console.error("Failed to play audio:", error)
      })
    }
  }

  // Listen for messages from the extension
  useEvent("message", handleMessage)

  return null // This component doesn't render anything
}

export default AudioPlayer
