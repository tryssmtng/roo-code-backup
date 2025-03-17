import * as vscode from "vscode"
import axios from "axios"

/**
 * Converts text to speech using OpenAI's TTS API
 * @param text The text to convert to speech
 * @param voiceModel The voice model to use (alloy, echo, fable, onyx, nova, shimmer)
 * @param apiKey OpenAI API key
 * @returns Base64 encoded audio data URL
 */
export async function textToSpeech(
  text: string,
  voiceModel: string,
  apiKey: string
): Promise<string> {
  try {
    const response = await axios.post(
      "https://api.openai.com/v1/audio/speech",
      {
        model: "tts-1",
        voice: voiceModel,
        input: text,
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        responseType: "arraybuffer",
      }
    )

    // Convert the audio data to a base64 data URL
    const audioData = Buffer.from(response.data).toString("base64")
    return `data:audio/mp3;base64,${audioData}`
  } catch (error: any) {
    vscode.window.showErrorMessage(`Text-to-speech error: ${error.message}`)
    throw error
  }
}

/**
 * Checks if the text is conversational and suitable for text-to-speech
 * @param text The text to check
 * @returns True if the text is conversational, false otherwise
 */
export function isConversationalText(text: string): boolean {
  // Check if the text contains code blocks or appears to be technical output
  const codeBlockRegex = /```[\s\S]*?```/
  const technicalPatterns = [
    /^import\s+[\w\s,{}]+\s+from\s+['"][\w\-./]+['"]/,  // import statements
    /^const\s+[\w\s,{}]+\s+=\s+/,                       // const declarations
    /^let\s+[\w\s,{}]+\s+=\s+/,                         // let declarations
    /^var\s+[\w\s,{}]+\s+=\s+/,                         // var declarations
    /^function\s+\w+\s*\(/,                             // function declarations
    /^class\s+\w+/,                                     // class declarations
    /^\s*<[\w\-]+[^>]*>/,                               // HTML tags
    /^\s*\{[\s\S]*?\}\s*$/,                             // JSON objects
    /^\s*\[[\s\S]*?\]\s*$/,                             // JSON arrays
  ]

  if (codeBlockRegex.test(text)) {
    return false
  }

  for (const pattern of technicalPatterns) {
    if (pattern.test(text)) {
      return false
    }
  }

  return true
}

/**
 * Retrieves the OpenAI API key from VSCode's secret storage
 * @returns The OpenAI API key or undefined if not found
 */
export async function getOpenAIApiKey(): Promise<string | undefined> {
  try {
    const secrets = await vscode.authentication.getSession('openai', ['api'], { createIfNone: false })
    return secrets?.accessToken
  } catch (error) {
    console.error('Failed to retrieve OpenAI API key:', error)
    return undefined
  }
}
