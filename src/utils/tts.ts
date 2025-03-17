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
    // Validate inputs
    if (!text || text.trim() === "") {
      const errorMsg = "Text cannot be empty";
      console.error(`[TTS Error]: ${errorMsg}`);
      throw new Error(errorMsg);
    }
    
    if (!voiceModel || voiceModel.trim() === "") {
      // Default to nova which sounds more human
      console.log("[TTS]: No voice specified, defaulting to nova (most human-like)");
      voiceModel = "nova";
    }
    
    if (!apiKey || !apiKey.startsWith("sk-")) {
      const errorMsg = "Invalid OpenAI API key format (should start with sk-)";
      console.error(`[TTS Error]: ${errorMsg}`);
      throw new Error(errorMsg);
    }
    
    // Use nova by default for more human-like conversations if not already specified
    if (voiceModel === "alloy") {
      console.log("[TTS]: Upgraded voice from alloy to nova for more human-like speech");
      voiceModel = "nova";
    }
    
    // Trim the text if it's too long (TTS API has a limit)
    let processedText = text;
    if (text.length > 4000) {
      processedText = text.substring(0, 4000);
      console.log(`[TTS]: Text was too long (${text.length} chars), trimmed to 4000 chars`);
    }
    
    console.log(`[TTS]: Calling OpenAI TTS API with model: tts-1-hd, voice: ${voiceModel}`);
    console.log(`[TTS]: Text length: ${processedText.length} chars`);
    
    // Make the API request with proper TTS-HD model
    const response = await axios.post(
      "https://api.openai.com/v1/audio/speech",
      {
        model: "tts-1-hd", // Using HD model for better quality
        voice: voiceModel,
        input: processedText,
        speed: 1.09, // Increased speed for faster, more natural human-like speech
        response_format: "mp3", // Ensure highest quality audio format
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        responseType: "arraybuffer",
        timeout: 30000, // 30 second timeout
      }
    );

    // Check response status
    if (response.status !== 200) {
      throw new Error(`OpenAI API returned status ${response.status}`);
    }

    // Convert the audio data to a base64 data URL
    const audioData = Buffer.from(response.data).toString("base64");
    console.log(`[TTS]: Successfully converted text to speech, audio data size: ${audioData.length} bytes`);
    return `data:audio/mp3;base64,${audioData}`;
  } catch (error) {
    // Enhanced error handling
    if (error.response) {
      // The request was made and the server responded with a status code
      // that falls out of the range of 2xx
      const statusCode = error.response.status;
      let errorMessage = `OpenAI API error (${statusCode}): `;
      
      if (statusCode === 401) {
        errorMessage += "Unauthorized. Check your API key.";
      } else if (statusCode === 429) {
        errorMessage += "Rate limit exceeded or insufficient quota.";
      } else if (statusCode === 404) {
        errorMessage += "Resource not found. Make sure TTS is available on your account.";
      } else {
        // Try to extract error message from response if possible
        try {
          const respData = error.response.data;
          if (typeof respData === 'string' || respData instanceof Buffer) {
            errorMessage += `${respData.toString().substring(0, 100)}`;
          } else if (respData && respData.error) {
            errorMessage += respData.error.message || JSON.stringify(respData);
          } else {
            errorMessage += "Unknown error";
          }
        } catch (e) {
          errorMessage += "Could not parse error details";
        }
      }
      
      console.error(`[TTS Error]: ${errorMessage}`);
      throw new Error(errorMessage);
    } else if (error.request) {
      // The request was made but no response was received
      const errorMsg = "No response received from OpenAI API - check your internet connection";
      console.error(`[TTS Error]: ${errorMsg}`, error.request);
      throw new Error(errorMsg);
    } else {
      // Something happened in setting up the request that triggered an Error
      console.error(`[TTS Error]: Error in text-to-speech request:`, error.message);
      throw error;
    }
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
    console.log("[TTS]: Attempting to retrieve OpenAI API key from secrets");
    const secrets = await vscode.authentication.getSession('openai', ['api'], { createIfNone: false });
    
    if (secrets?.accessToken) {
      console.log("[TTS]: Successfully retrieved OpenAI API key from secrets");
      return secrets.accessToken;
    } else {
      console.log("[TTS]: No OpenAI API key found in secrets");
      return undefined;
    }
  } catch (error) {
    console.error('[TTS Error]: Failed to retrieve OpenAI API key:', error);
    return undefined;
  }
}
