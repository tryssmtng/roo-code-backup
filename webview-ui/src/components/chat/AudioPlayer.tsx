import { useEffect, useRef, useState } from "react"
import { useExtensionState } from "../../context/ExtensionStateContext"
import { vscode } from "../../utils/vscode"

/**
 * AudioPlayer component that listens for audio messages from the extension
 * and plays them using the Web Audio API
 */
const AudioPlayer = () => {
  // Get the sound settings from the extension state
  const { soundEnabled, soundVolume, autoSpeakEnabled } = useExtensionState();
  const [isPlaying, setIsPlaying] = useState(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioQueue = useRef<{text: string, voice_id?: string}[]>([]);
  const audioElementRef = useRef<HTMLAudioElement | null>(null);
  
  // Override the sound setting for TTS - always allow TTS audio if autoSpeakEnabled is true
  const shouldPlayAudio = autoSpeakEnabled || soundEnabled;

  // Initialize audio context on load and user interaction
  useEffect(() => {
    // Force initialize AudioContext on component mount to prepare for playback
    const initializeAudioContext = () => {
      console.log("Attempting to initialize AudioContext");
      try {
        if (!audioContextRef.current) {
          audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({
            latencyHint: "interactive",
            sampleRate: 44100
          });
          console.log("AudioContext initialized successfully");
          
          // Resume immediately if possible
          if (audioContextRef.current.state === "suspended") {
            audioContextRef.current.resume().then(() => {
              console.log("AudioContext resumed successfully");
            }).catch(err => {
              console.error("Failed to resume AudioContext:", err);
            });
          }
        }
        return true;
      } catch (err) {
        console.error("Failed to initialize AudioContext:", err);
        return false;
      }
    };
    
    // Try to initialize right away
    initializeAudioContext();
    
    // Also initialize on user interaction
    const handleUserInteraction = () => {
      if (audioContextRef.current?.state === "suspended") {
        audioContextRef.current.resume().then(() => {
          console.log("AudioContext resumed after user interaction");
        }).catch(err => {
          console.error("Failed to resume AudioContext after interaction:", err);
        });
      }
    };

    // Add event listeners for user interaction
    window.addEventListener("click", handleUserInteraction);
    window.addEventListener("keydown", handleUserInteraction);
    window.addEventListener("touchstart", handleUserInteraction);

    return () => {
      window.removeEventListener("click", handleUserInteraction);
      window.removeEventListener("keydown", handleUserInteraction);
      window.removeEventListener("touchstart", handleUserInteraction);
      
      // Cleanup
      if (audioContextRef.current) {
        audioContextRef.current.close().catch(console.error);
      }
    };
  }, []);

  // Process audio messages
  const processAudioMessage = (message: any) => {
    // Check if we should play audio (either soundEnabled or autoSpeakEnabled)
    if (!shouldPlayAudio) {
      console.log("Audio is disabled in settings, but sending to extension for fallback playback");
      // Always try to play through the extension as fallback
      vscode.postMessage({
        type: "playAudioThroughExtension",
        text: message.text
      });
      return;
    }

    if (!message.text) {
      console.error("Received empty audio data");
      return;
    }

    if (isPlaying) {
      console.log("Already playing audio, queueing for later");
      audioQueue.current.push({
        text: message.text,
        voice_id: message.voice_id
      });
      return;
    }

    playAudio(message.text, message.voice_id);
  };

  // Play audio through the browser
  const playAudio = async (audioDataUrl: string, voice_id?: string) => {
    try {
      console.log(`Playing audio with voice: ${voice_id || "default"}`);
      setIsPlaying(true);

      if (!audioElementRef.current) {
        audioElementRef.current = new Audio();
        
        // Improve audio quality with better filtering
        if (audioContextRef.current) {
          try {
            const source = audioContextRef.current.createMediaElementSource(audioElementRef.current);
            
            // Add a low-pass filter to reduce high-frequency noise
            const lowpass = audioContextRef.current.createBiquadFilter();
            lowpass.type = "lowpass";
            lowpass.frequency.value = 8000; // Cut off very high frequencies
            
            // Add a high-pass filter to reduce low-frequency rumble
            const highpass = audioContextRef.current.createBiquadFilter();
            highpass.type = "highpass";
            highpass.frequency.value = 80; // Remove very low frequencies
            
            // Add a compressor to normalize volume and improve clarity
            const compressor = audioContextRef.current.createDynamicsCompressor();
            compressor.threshold.value = -24;
            compressor.knee.value = 30;
            compressor.ratio.value = 12;
            compressor.attack.value = 0.003;
            compressor.release.value = 0.25;
            
            // Connect the audio processing chain
            source.connect(highpass);
            highpass.connect(lowpass);
            lowpass.connect(compressor);
            compressor.connect(audioContextRef.current.destination);
            
            console.log("Audio processing chain configured successfully");
          } catch (err) {
            console.error("Error setting up audio processing:", err);
            // Continue anyway - we can still play without processing
          }
        }
      }

      // Set volume from settings (use higher default volume)
      audioElementRef.current.volume = soundVolume || 0.7;
      
      // Log the current state of the audio element
      console.log(`Audio element state - volume: ${audioElementRef.current.volume}, src length: ${audioDataUrl.length}`);
      
      // Set audio source
      audioElementRef.current.src = audioDataUrl;
      
      // Handle audio completion
      audioElementRef.current.onended = () => {
        console.log("Audio playback completed");
        handleAudioComplete();
      };
      
      // Handle errors during playback
      audioElementRef.current.onerror = (e) => {
        console.error("Audio playback error:", e);
        handleAudioComplete();
        
        // Try using extension-based playback as fallback
        vscode.postMessage({
          type: "playAudioThroughExtension",
          text: audioDataUrl
        });
      };
      
      // Start playback with a promise to detect success/failure
      try {
        console.log("Attempting to play audio...");
        // Resume audioContext first if needed
        if (audioContextRef.current?.state === "suspended") {
          await audioContextRef.current.resume();
        }
        await audioElementRef.current.play();
        console.log("Audio playback started successfully");
      } catch (playError) {
        console.error("Failed to play audio:", playError);
        // Try using extension-based playback as fallback
        vscode.postMessage({
          type: "playAudioThroughExtension",
          text: audioDataUrl
        });
        handleAudioComplete();
      }
      
    } catch (error) {
      console.error("Error in playAudio function:", error);
      handleAudioComplete();
      
      // Try using extension-based playback as fallback
      vscode.postMessage({
        type: "playAudioThroughExtension",
        text: audioDataUrl
      });
    }
  };

  // Handle audio completion and process next in queue
  const handleAudioComplete = () => {
    setIsPlaying(false);
    
    // Notify extension of completion
    vscode.postMessage({
      type: "logError",
      text: "Audio playback complete"
    });
    
    // Process next in queue if any
    if (audioQueue.current.length > 0) {
      const next = audioQueue.current.shift();
      if (next) {
        setTimeout(() => {
          playAudio(next.text, next.voice_id);
        }, 300); // Small delay between utterances for natural pauses
      }
    }
  };

  // Listen for audio messages from the extension
  useEffect(() => {
    const messageListener = (event: MessageEvent) => {
      const message = event.data;
      if (message.type === "playAudio") {
        processAudioMessage(message);
      }
    };

    window.addEventListener("message", messageListener);
    return () => {
      window.removeEventListener("message", messageListener);
    };
  }, [shouldPlayAudio, soundVolume, isPlaying]);

  // Component doesn't render anything visible
  return null;
}

export default AudioPlayer
