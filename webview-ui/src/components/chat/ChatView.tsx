import { VSCodeButton, VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import debounce from "debounce"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useDeepCompareEffect, useEvent, useMount } from "react-use"
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso"
import styled from "styled-components"
import {
	ClineAsk,
	ClineMessage,
	ClineSayBrowserAction,
	ClineSayTool,
	ExtensionMessage,
} from "../../../../src/shared/ExtensionMessage"
import { McpServer, McpTool } from "../../../../src/shared/mcp"
import { findLast } from "../../../../src/shared/array"
import { combineApiRequests } from "../../../../src/shared/combineApiRequests"
import { combineCommandSequences } from "../../../../src/shared/combineCommandSequences"
import { getApiMetrics } from "../../../../src/shared/getApiMetrics"
import { useExtensionState } from "../../context/ExtensionStateContext"
import { vscode } from "../../utils/vscode"
import HistoryPreview from "../history/HistoryPreview"
import { normalizeApiConfiguration } from "../settings/ApiOptions"
import Announcement from "./Announcement"
import BrowserSessionRow from "./BrowserSessionRow"
import ChatRow from "./ChatRow"
import ChatTextArea from "./ChatTextArea"
import TaskHeader from "./TaskHeader"
import AutoApproveMenu from "./AutoApproveMenu"
import { AudioType } from "../../../../src/shared/WebviewMessage"
import { validateCommand } from "../../utils/command-validation"
import { getAllModes } from "../../../../src/shared/modes"
import TelemetryBanner from "../common/TelemetryBanner"
import { useAppTranslation } from "@/i18n/TranslationContext"
import AudioPlayer from "./AudioPlayer"

interface ChatViewProps {
	isHidden: boolean
	showAnnouncement: boolean
	hideAnnouncement: () => void
	showHistoryView: () => void
}

export const MAX_IMAGES_PER_MESSAGE = 20 // Anthropic limits to 20 images

const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0

const ChatView = ({ isHidden, showAnnouncement, hideAnnouncement, showHistoryView }: ChatViewProps) => {
	const { t } = useAppTranslation()
	const modeShortcutText = `${isMac ? "⌘" : "Ctrl"} + . ${t("chat:forNextMode")}`
	const {
		version,
		clineMessages: messages,
		taskHistory,
		apiConfiguration,
		mcpServers,
		alwaysAllowBrowser,
		alwaysAllowReadOnly,
		alwaysAllowWrite,
		alwaysAllowExecute,
		alwaysAllowMcp,
		allowedCommands,
		writeDelayMs,
		mode,
		setMode,
		autoApprovalEnabled,
		alwaysAllowModeSwitch,
		alwaysAllowSubtasks,
		customModes,
		telemetrySetting,
		promptAutoEnhanceEnabled,
		autoSpeakEnabled,
		autoSpeakVoiceModel,
	} = useExtensionState()

	//const task = messages.length > 0 ? (messages[0].say === "task" ? messages[0] : undefined) : undefined) : undefined
	const task = useMemo(() => messages.at(0), [messages]) // leaving this less safe version here since if the first message is not a task, then the extension is in a bad state and needs to be debugged (see Cline.abort)
	const modifiedMessages = useMemo(() => combineApiRequests(combineCommandSequences(messages.slice(1))), [messages])
	// has to be after api_req_finished are all reduced into api_req_started messages
	const apiMetrics = useMemo(() => getApiMetrics(modifiedMessages), [modifiedMessages])

	const [inputValue, setInputValue] = useState("")
	const textAreaRef = useRef<HTMLTextAreaElement>(null)
	const [textAreaDisabled, setTextAreaDisabled] = useState(false)
	const [selectedImages, setSelectedImages] = useState<string[]>([])

	// we need to hold on to the ask because useEffect > lastMessage will always let us know when an ask comes in and handle it, but by the time handleMessage is called, the last message might not be the ask anymore (it could be a say that followed)
	const [clineAsk, setClineAsk] = useState<ClineAsk | undefined>(undefined)
	const [enableButtons, setEnableButtons] = useState<boolean>(false)
	const [primaryButtonText, setPrimaryButtonText] = useState<string | undefined>(undefined)
	const [secondaryButtonText, setSecondaryButtonText] = useState<string | undefined>(undefined)
	const [didClickCancel, setDidClickCancel] = useState(false)
	const virtuosoRef = useRef<VirtuosoHandle>(null)
	const [expandedRows, setExpandedRows] = useState<Record<number, boolean>>({})
	const scrollContainerRef = useRef<HTMLDivElement>(null)
	const disableAutoScrollRef = useRef(false)
	const [showScrollToBottom, setShowScrollToBottom] = useState(false)
	const [isAtBottom, setIsAtBottom] = useState(false)

	const [wasStreaming, setWasStreaming] = useState<boolean>(false)
	const [showCheckpointWarning, setShowCheckpointWarning] = useState<boolean>(false)
	
	// Add a temporary stub for groupedMessages to resolve TypeScript errors
	// This will be overridden later by the actual implementation
	const tempGroupedMessages: any[] = [];
	const groupedMessagesRef = useRef<any[]>(tempGroupedMessages);

	// UI layout depends on the last 2 messages
	// (since it relies on the content of these messages, we are deep comparing. i.e. the button state after hitting button sets enableButtons to false, and this effect otherwise would have to true again even if messages didn't change
	const lastMessage = useMemo(() => messages.at(-1), [messages])
	const secondLastMessage = useMemo(() => messages.at(-2), [messages])

	// Add these refs near the beginning of the component
	const lastTtsRef = useRef<number>(0);
	const ttsPlayedMessages = useRef<Set<string>>(new Set());
	const [lastSpokenMessageIndex, setLastSpokenMessageIndex] = useState<number>(-1);
	const lastSpokenContentRef = useRef<string>("");
	
	// Add new state to track if TTS is currently playing
	const [isTtsSpeaking, setIsTtsSpeaking] = useState(false);
	// Add a ref to track TTS request pending status
	const ttsPendingRef = useRef<boolean>(false);
	// Add ref to track current streaming message content for real-time TTS
	const streamingContentRef = useRef<string>("");
	// Add ref to track the last TTS chunk sent for streaming
	const lastTtsSentChunkRef = useRef<string>("");
	// Add throttle timer ref to avoid too many TTS requests
	const ttsThrottleTimerRef = useRef<any>(null);

	// Add speech enhancements for better natural flow
	const addSpeechEnhancements = (text: string): string => {
		// Make the text sound more natural with conversational adjustments
		
		// Format contractions without spaces (couldn't vs could n't)
		let enhancedText = text
			.replace(/(\w+) n't/g, "$1n't")
			
			// Ensure natural pauses with proper punctuation spacing
			.replace(/([.!?])(\S)/g, '$1 $2')
			
			// Add subtle pauses for commas
			.replace(/,([^\s])/g, ', $1')
			
			// Remove excessive spaces
			.replace(/\s+/g, ' ')
			
			// Add more human-like speech patterns with interjections
			.replace(/([.!?]) (But|And|So|Because|However)/g, '$1 ... $2')
			
			// Make questions sound more natural
			.replace(/\?(\s*[A-Z])/g, '? ... $1')
			
			// Add emphasis to important words
			.replace(/(important|critical|essential|necessary|crucial|vital)/gi, ' $1 ')
			
			// Clean up any double spaces from our replacements
			.replace(/\s+/g, ' ')
			.trim();
			
		console.log("Enhanced TTS text with more natural patterns");
		
		return enhancedText;
	};

	function playSound(audioType: AudioType) {
		vscode.postMessage({ type: "playSound", audioType })
	}

	useDeepCompareEffect(() => {
		// if last message is an ask, show user ask UI
		// if user finished a task, then start a new task with a new conversation history since in this moment that the extension is waiting for user response, the user could close the extension and the conversation history would be lost.
		// basically as long as a task is active, the conversation history will be persisted
		if (lastMessage) {
			switch (lastMessage.type) {
				case "ask":
					const isPartial = lastMessage.partial === true
					switch (lastMessage.ask) {
						case "api_req_failed":
							playSound("progress_loop")
							setTextAreaDisabled(true)
							setClineAsk("api_req_failed")
							setEnableButtons(true)
							setPrimaryButtonText(t("chat:retry.title"))
							setSecondaryButtonText(t("chat:startNewTask.title"))
							break
						case "mistake_limit_reached":
							playSound("progress_loop")
							setTextAreaDisabled(false)
							setClineAsk("mistake_limit_reached")
							setEnableButtons(true)
							setPrimaryButtonText(t("chat:proceedAnyways.title"))
							setSecondaryButtonText(t("chat:startNewTask.title"))
							break
						case "followup":
							setTextAreaDisabled(isPartial)
							setClineAsk("followup")
							setEnableButtons(isPartial)
							// setPrimaryButtonText(undefined)
							// setSecondaryButtonText(undefined)
							break
						case "tool":
							if (!isAutoApproved(lastMessage)) {
								playSound("notification")
							}
							setTextAreaDisabled(isPartial)
							setClineAsk("tool")
							setEnableButtons(!isPartial)
							const tool = JSON.parse(lastMessage.text || "{}") as ClineSayTool
							switch (tool.tool) {
								case "editedExistingFile":
								case "appliedDiff":
								case "newFileCreated":
									setPrimaryButtonText(t("chat:save.title"))
									setSecondaryButtonText(t("chat:reject.title"))
									break
								case "finishTask":
									setPrimaryButtonText(t("chat:completeSubtaskAndReturn.title"))
									setSecondaryButtonText(undefined)
									break
								default:
									setPrimaryButtonText(t("chat:approve.title"))
									setSecondaryButtonText(t("chat:reject.title"))
									break
							}
							break
						case "browser_action_launch":
							if (!isAutoApproved(lastMessage)) {
								playSound("notification")
							}
							setTextAreaDisabled(isPartial)
							setClineAsk("browser_action_launch")
							setEnableButtons(!isPartial)
							setPrimaryButtonText(t("chat:approve.title"))
							setSecondaryButtonText(t("chat:reject.title"))
							break
						case "command":
							if (!isAutoApproved(lastMessage)) {
								playSound("notification")
							}
							setTextAreaDisabled(isPartial)
							setClineAsk("command")
							setEnableButtons(!isPartial)
							setPrimaryButtonText(t("chat:runCommand.title"))
							setSecondaryButtonText(t("chat:reject.title"))
							break
						case "command_output":
							setTextAreaDisabled(false)
							setClineAsk("command_output")
							setEnableButtons(true)
							setPrimaryButtonText(t("chat:proceedWhileRunning.title"))
							setSecondaryButtonText(undefined)
							break
						case "use_mcp_server":
							setTextAreaDisabled(isPartial)
							setClineAsk("use_mcp_server")
							setEnableButtons(!isPartial)
							setPrimaryButtonText(t("chat:approve.title"))
							setSecondaryButtonText(t("chat:reject.title"))
							break
						case "completion_result":
							// extension waiting for feedback. but we can just present a new task button
							playSound("celebration")
							setTextAreaDisabled(isPartial)
							setClineAsk("completion_result")
							setEnableButtons(!isPartial)
							setPrimaryButtonText(t("chat:startNewTask.title"))
							setSecondaryButtonText(undefined)
							break
						case "resume_task":
							setTextAreaDisabled(false)
							setClineAsk("resume_task")
							setEnableButtons(true)
							setPrimaryButtonText(t("chat:resumeTask.title"))
							setSecondaryButtonText(t("chat:terminate.title"))
							setDidClickCancel(false) // special case where we reset the cancel button state
							break
						case "resume_completed_task":
							setTextAreaDisabled(false)
							setClineAsk("resume_completed_task")
							setEnableButtons(true)
							setPrimaryButtonText(t("chat:startNewTask.title"))
							setSecondaryButtonText(undefined)
							setDidClickCancel(false)
							break
					}
					break
				case "say":
					// don't want to reset since there could be a "say" after an "ask" while ask is waiting for response
					switch (lastMessage.say) {
						case "api_req_retry_delayed":
							setTextAreaDisabled(true)
							break
						case "api_req_started":
							if (secondLastMessage?.ask === "command_output") {
								// if the last ask is a command_output, and we receive an api_req_started, then that means the command has finished and we don't need input from the user anymore (in every other case, the user has to interact with input field or buttons to continue, which does the following automatically)
								setInputValue("")
								setTextAreaDisabled(true)
								setSelectedImages([])
								setClineAsk(undefined)
								setEnableButtons(false)
							}
							break
						case "api_req_finished":
						case "task":
						case "error":
						case "text":
						case "browser_action":
						case "browser_action_result":
						case "command_output":
						case "mcp_server_request_started":
						case "mcp_server_response":
						case "completion_result":
						case "tool":
							break
					}
					break
			}
		} else {
			// this would get called after sending the first message, so we have to watch messages.length instead
			// No messages, so user has to submit a task
			// setTextAreaDisabled(false)
			// setClineAsk(undefined)
			// setPrimaryButtonText(undefined)
			// setSecondaryButtonText(undefined)
		}
	}, [lastMessage, secondLastMessage])

	useEffect(() => {
		if (messages.length === 0) {
			setTextAreaDisabled(false)
			setClineAsk(undefined)
			setEnableButtons(false)
			setPrimaryButtonText(undefined)
			setSecondaryButtonText(undefined)
		}
	}, [messages.length])

	useEffect(() => {
		setExpandedRows({})
	}, [task?.ts])

	const isStreaming = useMemo(() => {
		const isLastAsk = !!modifiedMessages.at(-1)?.ask // checking clineAsk isn't enough since messages effect may be called again for a tool for example, set clineAsk to its value, and if the next message is not an ask then it doesn't reset. This is likely due to how much more often we're updating messages as compared to before, and should be resolved with optimizations as it's likely a rendering bug. but as a final guard for now, the cancel button will show if the last message is not an ask
		const isToolCurrentlyAsking =
			isLastAsk && clineAsk !== undefined && enableButtons && primaryButtonText !== undefined
		if (isToolCurrentlyAsking) {
			return false
		}

		const isLastMessagePartial = modifiedMessages.at(-1)?.partial === true
		if (isLastMessagePartial) {
			return true
		} else {
			const lastApiReqStarted = findLast(modifiedMessages, (message) => message.say === "api_req_started")
			if (
				lastApiReqStarted &&
				lastApiReqStarted.text !== null &&
				lastApiReqStarted.text !== undefined &&
				lastApiReqStarted.say === "api_req_started"
			) {
				const cost = JSON.parse(lastApiReqStarted.text).cost
				if (cost === undefined) {
					// api request has not finished yet
					return true
				}
			}
		}

		return false
	}, [modifiedMessages, clineAsk, enableButtons, primaryButtonText])

	const handleChatReset = useCallback(() => {
		// Only reset message-specific state, preserving mode.
		setInputValue("")
		setTextAreaDisabled(true)
		setSelectedImages([])
		setClineAsk(undefined)
		setEnableButtons(false)
		// Do not reset mode here as it should persist.
		// setPrimaryButtonText(undefined)
		// setSecondaryButtonText(undefined)
		disableAutoScrollRef.current = false
	}, [])

	const [isEnhancingPrompt, setIsEnhancingPrompt] = useState(false)

	const handleSendMessage = useCallback(
		async (text: string, images: string[]) => {
			text = text.trim()
			if (text || images.length > 0) {
				// Check if prompt auto-enhance is enabled
				if (promptAutoEnhanceEnabled && text) {
					setIsEnhancingPrompt(true)
					const message = {
						type: "enhancePrompt" as const,
						text: text,
					}
					vscode.postMessage(message)
					
					// Wait for the enhanced prompt response
					const enhancedPromptPromise = new Promise<string>((resolve) => {
						const messageHandler = (event: MessageEvent) => {
							const message = event.data
							if (message.type === "enhancedPrompt") {
								window.removeEventListener("message", messageHandler)
								resolve(message.text || text)
							}
						}
						window.addEventListener("message", messageHandler)
					})
					
					// Use the enhanced text or fall back to original
					const enhancedText = await enhancedPromptPromise
					text = enhancedText || text
					setIsEnhancingPrompt(false)
				}
				
				if (messages.length === 0) {
					vscode.postMessage({ type: "newTask", text, images })
				} else if (clineAsk) {
					switch (clineAsk) {
						case "followup":
						case "tool":
						case "browser_action_launch":
						case "command": // User can provide feedback to a tool or command use.
						case "command_output": // User can send input to command stdin.
						case "use_mcp_server":
						case "completion_result": // If this happens then the user has feedback for the completion result.
						case "resume_task":
						case "resume_completed_task":
						case "mistake_limit_reached":
							vscode.postMessage({ type: "askResponse", askResponse: "messageResponse", text, images })
							break
						// There is no other case that a textfield should be enabled.
					}
				}
				handleChatReset()
			}
		},
		[messages.length, clineAsk, handleChatReset, promptAutoEnhanceEnabled],
	)

	const handleSetChatBoxMessage = useCallback(
		(text: string, images: string[]) => {
			// Avoid nested template literals by breaking down the logic
			let newValue = text
			if (inputValue !== "") {
				newValue = inputValue + " " + text
			}

			setInputValue(newValue)
			setSelectedImages([...selectedImages, ...images])
		},
		[inputValue, selectedImages],
	)

	const startNewTask = useCallback(() => {
		vscode.postMessage({ type: "clearTask" })
	}, [])

	/*
	This logic depends on the useEffect[messages] above to set clineAsk, after which buttons are shown and we then send an askResponse to the extension.
	*/
	const handlePrimaryButtonClick = useCallback(
		(text?: string, images?: string[]) => {
			const trimmedInput = text?.trim()
			switch (clineAsk) {
				case "api_req_failed":
				case "command":
				case "command_output":
				case "tool":
				case "browser_action_launch":
				case "use_mcp_server":
				case "resume_task":
				case "mistake_limit_reached":
					// Only send text/images if they exist
					if (trimmedInput || (images && images.length > 0)) {
						vscode.postMessage({
							type: "askResponse",
							askResponse: "yesButtonClicked",
							text: trimmedInput,
							images: images,
						})
					} else {
						vscode.postMessage({
							type: "askResponse",
							askResponse: "yesButtonClicked",
						})
					}
					// Clear input state after sending
					setInputValue("")
					setSelectedImages([])
					break
				case "completion_result":
				case "resume_completed_task":
					// extension waiting for feedback. but we can just present a new task button
					startNewTask()
					break
			}
			setTextAreaDisabled(true)
			setClineAsk(undefined)
			setEnableButtons(false)
			disableAutoScrollRef.current = false
		},
		[clineAsk, startNewTask],
	)

	const handleSecondaryButtonClick = useCallback(
		(text?: string, images?: string[]) => {
			const trimmedInput = text?.trim()
			if (isStreaming) {
				vscode.postMessage({ type: "cancelTask" })
				setDidClickCancel(true)
				return
			}

			switch (clineAsk) {
				case "api_req_failed":
				case "mistake_limit_reached":
				case "resume_task":
					startNewTask()
					break
				case "command":
				case "tool":
				case "browser_action_launch":
				case "use_mcp_server":
					// Only send text/images if they exist
					if (trimmedInput || (images && images.length > 0)) {
						vscode.postMessage({
							type: "askResponse",
							askResponse: "noButtonClicked",
							text: trimmedInput,
							images: images,
						})
					} else {
						// responds to the API with a "This operation failed" and lets it try again
						vscode.postMessage({
							type: "askResponse",
							askResponse: "noButtonClicked",
						})
					}
					// Clear input state after sending
					setInputValue("")
					setSelectedImages([])
					break
			}
			setTextAreaDisabled(true)
			setClineAsk(undefined)
			setEnableButtons(false)
			disableAutoScrollRef.current = false
		},
		[clineAsk, startNewTask, isStreaming],
	)

	const handleTaskCloseButtonClick = useCallback(() => {
		startNewTask()
	}, [startNewTask])

	const { selectedModelInfo } = useMemo(() => {
		return normalizeApiConfiguration(apiConfiguration)
	}, [apiConfiguration])

	const selectImages = useCallback(() => {
		vscode.postMessage({ type: "selectImages" })
	}, [])

	const shouldDisableImages =
		!selectedModelInfo.supportsImages || textAreaDisabled || selectedImages.length >= MAX_IMAGES_PER_MESSAGE

	const handleMessage = useCallback(
		(e: MessageEvent) => {
			const message: ExtensionMessage = e.data
			switch (message.type) {
				case "action":
					switch (message.action!) {
						case "didBecomeVisible":
							if (!isHidden && !textAreaDisabled && !enableButtons) {
								textAreaRef.current?.focus()
							}
							break
					}
					break
				case "selectedImages":
					const newImages = message.images ?? []
					if (newImages.length > 0) {
						setSelectedImages((prevImages) =>
							[...prevImages, ...newImages].slice(0, MAX_IMAGES_PER_MESSAGE),
						)
					}
					break
				case "invoke":
					switch (message.invoke!) {
						case "newChat":
							handleChatReset()
							break
						case "sendMessage":
							handleSendMessage(message.text ?? "", message.images ?? [])
							break
						case "setChatBoxMessage":
							handleSetChatBoxMessage(message.text ?? "", message.images ?? [])
							break
						case "primaryButtonClick":
							handlePrimaryButtonClick(message.text ?? "", message.images ?? [])
							break
						case "secondaryButtonClick":
							handleSecondaryButtonClick(message.text ?? "", message.images ?? [])
							break
					}
			}
			// textAreaRef.current is not explicitly required here since react gaurantees that ref will be stable across re-renders, and we're not using its value but its reference.
		},
		[
			isHidden,
			textAreaDisabled,
			enableButtons,
			handleChatReset,
			handleSendMessage,
			handleSetChatBoxMessage,
			handlePrimaryButtonClick,
			handleSecondaryButtonClick,
		],
	)

	useEvent("message", handleMessage)

	useMount(() => {
		// NOTE: the vscode window needs to be focused for this to work
		textAreaRef.current?.focus()
	})

	useEffect(() => {
		const timer = setTimeout(() => {
			if (!isHidden && !textAreaDisabled && !enableButtons) {
				textAreaRef.current?.focus()
			}
		}, 50)
		return () => {
			clearTimeout(timer)
		}
	}, [isHidden, textAreaDisabled, enableButtons])

	const visibleMessages = useMemo(() => {
		return modifiedMessages.filter((message) => {
			switch (message.ask) {
				case "completion_result":
					// don't show a chat row for a completion_result ask without text. This specific type of message only occurs if cline wants to execute a command as part of its completion result, in which case we interject the completion_result tool with the execute_command tool.
					if (message.text === "") {
						return false
					}
					break
				case "api_req_failed": // this message is used to update the latest api_req_started that the request failed
				case "resume_task":
				case "resume_completed_task":
					return false
			}
			switch (message.say) {
				case "api_req_finished": // combineApiRequests removes this from modifiedMessages anyways
				case "api_req_retried": // this message is used to update the latest api_req_started that the request was retried
				case "api_req_deleted": // aggregated api_req metrics from deleted messages
					return false
				case "api_req_retry_delayed":
					// Only show the retry message if it's the last message
					return message === modifiedMessages.at(-1)
				case "text":
					// Sometimes cline returns an empty text message, we don't want to render these. (We also use a say text for user messages, so in case they just sent images we still render that)
					if ((message.text ?? "") === "" && (message.images?.length ?? 0) === 0) {
						return false
					}
					break
				case "mcp_server_request_started":
					return false
			}
			return true
		})
	}, [modifiedMessages])

	const isReadOnlyToolAction = useCallback((message: ClineMessage | undefined) => {
		if (message?.type === "ask") {
			if (!message.text) {
				return true
			}
			const tool = JSON.parse(message.text)
			return [
				"readFile",
				"listFiles",
				"listFilesTopLevel",
				"listFilesRecursive",
				"listCodeDefinitionNames",
				"searchFiles",
			].includes(tool.tool)
		}
		return false
	}, [])

	const isWriteToolAction = useCallback((message: ClineMessage | undefined) => {
		if (message?.type === "ask") {
			if (!message.text) {
				return true
			}
			const tool = JSON.parse(message.text)
			return ["editedExistingFile", "appliedDiff", "newFileCreated"].includes(tool.tool)
		}
		return false
	}, [])

	const isMcpToolAlwaysAllowed = useCallback(
		(message: ClineMessage | undefined) => {
			if (message?.type === "ask" && message.ask === "use_mcp_server") {
				if (!message.text) {
					return true
				}
				const mcpServerUse = JSON.parse(message.text) as { type: string; serverName: string; toolName: string }
				if (mcpServerUse.type === "use_mcp_tool") {
					const server = mcpServers?.find((s: McpServer) => s.name === mcpServerUse.serverName)
					const tool = server?.tools?.find((t: McpTool) => t.name === mcpServerUse.toolName)
					return tool?.alwaysAllow || false
				}
			}
			return false
		},
		[mcpServers],
	)

	// Check if a command message is allowed
	const isAllowedCommand = useCallback(
		(message: ClineMessage | undefined): boolean => {
			if (message?.type !== "ask") return false
			return validateCommand(message.text || "", allowedCommands || [])
		},
		[allowedCommands],
	)

	const isAutoApproved = useCallback(
		(message: ClineMessage | undefined) => {
			if (!autoApprovalEnabled || !message || message.type !== "ask") return false

			return (
				(alwaysAllowBrowser && message.ask === "browser_action_launch") ||
				(alwaysAllowReadOnly && message.ask === "tool" && isReadOnlyToolAction(message)) ||
				(alwaysAllowWrite && message.ask === "tool" && isWriteToolAction(message)) ||
				(alwaysAllowExecute && message.ask === "command" && isAllowedCommand(message)) ||
				(alwaysAllowMcp && message.ask === "use_mcp_server" && isMcpToolAlwaysAllowed(message)) ||
				(alwaysAllowModeSwitch &&
					message.ask === "tool" &&
					JSON.parse(message.text || "{}")?.tool === "switchMode") ||
				(alwaysAllowSubtasks &&
					message.ask === "tool" &&
					["newTask", "finishTask"].includes(JSON.parse(message.text || "{}")?.tool))
			)
		},
		[
			autoApprovalEnabled,
			alwaysAllowBrowser,
			alwaysAllowReadOnly,
			isReadOnlyToolAction,
			alwaysAllowWrite,
			isWriteToolAction,
			alwaysAllowExecute,
			isAllowedCommand,
			alwaysAllowMcp,
			isMcpToolAlwaysAllowed,
			alwaysAllowModeSwitch,
			alwaysAllowSubtasks,
		],
	)

	// Real-time streaming TTS implementation - speaks as content is generated
	useEffect(() => {
		// Only process when auto-speak is enabled and we have messages
		if (!autoSpeakEnabled || modifiedMessages.length === 0) return;

		// Get the most recent message that's still streaming
		const streamingMessage = isStreaming ? modifiedMessages.at(-1) : null;
		if (!streamingMessage || streamingMessage.partial !== true) return;

		// Skip if it's not a suitable message type for TTS
		if (
			!(streamingMessage.type === "say" && (
				streamingMessage.say === "text" ||
				streamingMessage.say === "completion_result" ||
				streamingMessage.say?.includes("task_completed")
			))
		) {
			console.log(`TTS Streaming - Skipping message with type ${streamingMessage.type}/${streamingMessage.say}`);
			return;
		}

		// Get the current text content
		const currentText = streamingMessage.text || "";
		if (currentText.length < 5) return; // Too short to speak

		// Compare with previous content to find new text to speak
		const previousContent = streamingContentRef.current;
		streamingContentRef.current = currentText;

		// If no new content or currently speaking, don't proceed
		if (previousContent === currentText || isTtsSpeaking) return;

		// Find new content to speak (what was added since last update)
		let newContent = "";
		if (previousContent.length === 0) {
			// First chunk - wait for a reasonable amount of text
			if (currentText.length < 30) return;
			newContent = currentText;
		} else {
			// Get only the new content that was added
			newContent = currentText.substring(previousContent.length);
		}

		// Skip if new content is too short or already spoken
		if (newContent.length < 20 || newContent === lastTtsSentChunkRef.current) return;

		// Check if this content contains a complete sentence
		const sentenceEndRegex = /[.!?]\s*$/;
		const hasCompleteSentence = sentenceEndRegex.test(newContent);

		// Only speak complete sentences or substantial chunks
		if (!hasCompleteSentence && newContent.length < 50) {
			console.log(`TTS Streaming - Waiting for complete sentence, current chunk: ${newContent.length} chars`);
			return;
		}

		// Throttle TTS requests to avoid overloading
		if (ttsThrottleTimerRef.current) {
			clearTimeout(ttsThrottleTimerRef.current);
		}

		ttsThrottleTimerRef.current = setTimeout(() => {
			// Skip technical content
			if (
				newContent.includes('```') || 
				newContent.startsWith('import ') ||
				newContent.startsWith('export ') ||
				newContent.startsWith('function ') ||
				newContent.startsWith('const ') ||
				newContent.startsWith('let ')
			) {
				console.log(`TTS Streaming - Skipping technical content`);
				return;
			}

			console.log(`TTS Streaming - Speaking new content (${newContent.length} chars)`);
			lastTtsSentChunkRef.current = newContent;
			setIsTtsSpeaking(true);

			// Enhance text for better TTS quality
			const enhancedText = addSpeechEnhancements(newContent);

			// Send to extension for speech
			vscode.postMessage({ 
				type: "textToSpeech", 
				text: enhancedText,
				voiceModel: autoSpeakVoiceModel || "alloy"
			});

			// Set up completion handler
			const handleTtsComplete = (event: MessageEvent) => {
				const message = event.data;
				if (
					(message.type === "logError" && message.text === "Audio playback complete") ||
					message.type === "playAudio"
				) {
					window.removeEventListener("message", handleTtsComplete);
					setIsTtsSpeaking(false);
				}
			};

			window.addEventListener("message", handleTtsComplete);

			// Safety timeout
			setTimeout(() => {
				window.removeEventListener("message", handleTtsComplete);
				setIsTtsSpeaking(false);
			}, 10000);
		}, 250); // Small delay to collect more text and avoid too frequent requests
	}, [modifiedMessages, isStreaming, autoSpeakEnabled, autoSpeakVoiceModel, isTtsSpeaking]);

	// Also keep the original completed-message TTS for when streaming finishes
	useEffect(() => {
		// Only attempt TTS when we have messages, auto-speak is enabled, and not currently speaking or pending
		if (modifiedMessages.length > 0 && autoSpeakEnabled && !isTtsSpeaking && !ttsPendingRef.current) {
			// Get the most recent complete message (not streaming)
			const latestMessage = modifiedMessages[modifiedMessages.length - 1];
			const isLastMessageStreaming = isStreaming && modifiedMessages.at(-1)?.partial === true;
			
			// Only process completed messages, not streaming ones
			if (!isLastMessageStreaming && latestMessage) {
				// Detailed logging to debug the message state
				console.log(`TTS Debug - Processing message: type=${latestMessage?.type}, say=${latestMessage?.say}, text length=${latestMessage?.text?.length || 0}`);
				
				// Enhanced checks for valid speech content
				if (
					latestMessage &&
					latestMessage.text && 
					typeof latestMessage.text === 'string' && 
					(
						(latestMessage.type === "say" && (
							latestMessage.say === "text" || 
							latestMessage.say === "completion_result" ||
							// Check for task completed message in a way that doesn't trigger type errors
							(latestMessage.say && latestMessage.say.includes("task_completed"))
						)) ||
						(latestMessage.type === "ask" && latestMessage.text.trim().length > 0)
					)
				) {
					// Generate a unique ID for this message
					const messageId = `${latestMessage.type}_${latestMessage.say || ''}_${latestMessage.ts}`;
					
					// Check if this is new content to avoid duplicates
					if (!ttsPlayedMessages.current.has(messageId)) {
						console.log(`TTS Debug - Processing message for speech`);
						
						// Text preprocessing for better TTS quality
						const rawContent = latestMessage.text.trim();
						
						// Don't process if too short
						if (rawContent.length <= 3) {
							console.log(`TTS Debug - Message too short for TTS: ${rawContent}`);
							return;
						}
						
						// Skip technical content that doesn't make sense to speak
						if (
							rawContent.includes('```') || // code blocks
							rawContent.startsWith('import ') ||
							rawContent.startsWith('export ') ||
							rawContent.startsWith('function ') ||
							rawContent.startsWith('const ') ||
							rawContent.startsWith('let ') ||
							rawContent.startsWith('var ') ||
							rawContent.includes('<script') ||
							rawContent.includes('</script>')
						) {
							console.log(`TTS Debug - Skipping technical content not suitable for TTS`);
							return;
						}
						
						console.log(`TTS Debug - Speaking full message content`);
						
						// Mark as speaking and pending to prevent overlap
						setIsTtsSpeaking(true);
						ttsPendingRef.current = true;
						
						// Add to played messages set to avoid duplicates
						ttsPlayedMessages.current.add(messageId);
						
						// Prepare full text with basic enhancements
						const enhancedText = addSpeechEnhancements(rawContent);
						
						try {
							// Send to extension for speech (full message at once)
							console.log(`TTS Debug - Sending textToSpeech message to extension with ${enhancedText.length} characters`);
							vscode.postMessage({ 
								type: "textToSpeech", 
								text: enhancedText,
								voiceModel: autoSpeakVoiceModel || "alloy"
							});
							
							// Listen for TTS completion or audio playback events from extension
							const handleTtsComplete = (event: MessageEvent) => {
								const message = event.data;
								// Check for completion message
								if (
									(message.type === "logError" && message.text === "Audio playback complete") ||
									(message.type === "playAudio" && message.text) // The audio data was sent back
								) {
									console.log(`TTS Debug - Speech completed or audio data received`);
									if (message.type === "playAudio") {
										// If we receive audio data, assume it will play and remove the pending flag
										console.log(`TTS Debug - Audio data received, length: ${message.text?.length || 0}`);
										ttsPendingRef.current = false;
										// Note: keep isTtsSpeaking true until playback completes
									} else {
										// If we receive completion message, remove all flags
										console.log(`TTS Debug - Received playback complete message`);
										window.removeEventListener("message", handleTtsComplete);
										setIsTtsSpeaking(false);
										ttsPendingRef.current = false;
									}
								}
							};
							
							window.addEventListener("message", handleTtsComplete);
							
							// Safety timeout in case completion event never arrives
							setTimeout(() => {
								console.log(`TTS Debug - Watchdog timer fired for speech`);
								window.removeEventListener("message", handleTtsComplete);
								setIsTtsSpeaking(false);
								ttsPendingRef.current = false;
							}, 30000); // Longer timeout for full messages
						} catch (error) {
							console.log(`TTS Debug - Error sending TTS message: ${error}`);
							setIsTtsSpeaking(false);
							ttsPendingRef.current = false;
						}
					} else {
						console.log(`TTS Debug - Skipping already spoken message: ${messageId}`);
					}
				} else {
					// Log why the message wasn't spoken
					if (!latestMessage) {
						console.log(`TTS Debug - No message available`);
					} else if (!latestMessage.text || typeof latestMessage.text !== 'string') {
						console.log(`TTS Debug - Message has no text content`);
					} else {
						console.log(`TTS Debug - Message type/say not supported for TTS: ${latestMessage.type}/${latestMessage.say}`);
					}
				}
			} else if (isLastMessageStreaming) {
				console.log("TTS Debug - Skipping streaming message, waiting for completion");
			}
		}
	}, [modifiedMessages, autoSpeakEnabled, autoSpeakVoiceModel, isTtsSpeaking, isStreaming]);

	// Update wasStreaming when streaming state changes
	useEffect(() => {
		setWasStreaming(isStreaming);
	}, [isStreaming]);

	// scrolling

	const scrollToBottomSmooth = useMemo(
		() =>
			debounce(
				() => {
					virtuosoRef.current?.scrollTo({
						top: Number.MAX_SAFE_INTEGER,
						behavior: "smooth",
					})
				},
				10,
				{ immediate: true },
			),
		[],
	)

	const scrollToBottomAuto = useCallback(() => {
		virtuosoRef.current?.scrollTo({
			top: Number.MAX_SAFE_INTEGER,
			behavior: "auto", // instant causes crash
		})
	}, [])

	// scroll when user toggles certain rows
	const toggleRowExpansion = useCallback(
		(ts: number) => {
			const isCollapsing = expandedRows[ts] ?? false
			const messages = groupedMessagesRef.current;
			const lastGroup = messages.at(-1)
			const isLast = Array.isArray(lastGroup) ? lastGroup[0].ts === ts : lastGroup?.ts === ts
			const secondToLastGroup = messages.at(-2)
			const isSecondToLast = Array.isArray(secondToLastGroup)
				? secondToLastGroup[0].ts === ts
				: secondToLastGroup?.ts === ts

			const isLastCollapsedApiReq =
				isLast &&
				!Array.isArray(lastGroup) && // Make sure it's not a browser session group
				lastGroup?.say === "api_req_started" &&
				!expandedRows[lastGroup.ts]

			setExpandedRows((prev) => ({
				...prev,
				[ts]: !prev[ts],
			}))

			// disable auto scroll when user expands row
			if (!isCollapsing) {
				disableAutoScrollRef.current = true
			}

			if (isCollapsing && isAtBottom) {
				const timer = setTimeout(() => {
					scrollToBottomAuto()
				}, 0)
				return () => clearTimeout(timer)
			} else if (isLast || isSecondToLast) {
				if (isCollapsing) {
					if (isSecondToLast && !isLastCollapsedApiReq) {
						return
					}
					const timer = setTimeout(() => {
						scrollToBottomAuto()
					}, 0)
					return () => clearTimeout(timer)
				} else {
					const timer = setTimeout(() => {
						virtuosoRef.current?.scrollToIndex({
							index: messages.length - (isLast ? 1 : 2),
							align: "start",
						})
					}, 0)
					return () => clearTimeout(timer)
				}
			}
		},
		[expandedRows, scrollToBottomAuto, isAtBottom],
	)

	const handleRowHeightChange = useCallback(
		(isTaller: boolean) => {
			if (!disableAutoScrollRef.current) {
				if (isTaller) {
					scrollToBottomSmooth()
				} else {
					setTimeout(() => {
						scrollToBottomAuto()
					}, 0)
				}
			}
		},
		[scrollToBottomSmooth, scrollToBottomAuto],
	)

	useEffect(() => {
		if (!disableAutoScrollRef.current) {
			setTimeout(() => {
				scrollToBottomSmooth()
			}, 50)
			// return () => clearTimeout(timer) // dont cleanup since if visibleMessages.length changes it cancels.
		}
	}, [groupedMessagesRef.current.length, scrollToBottomSmooth])

	const handleWheel = useCallback((event: Event) => {
		const wheelEvent = event as WheelEvent
		if (wheelEvent.deltaY && wheelEvent.deltaY < 0) {
			if (scrollContainerRef.current?.contains(wheelEvent.target as Node)) {
				// user scrolled up
				disableAutoScrollRef.current = true
			}
		}
	}, [])
	useEvent("wheel", handleWheel, window, { passive: true }) // passive improves scrolling performance

	// Effect to handle showing the checkpoint warning after a delay
	useEffect(() => {
		// Only show the warning when there's a task but no visible messages yet
		if (task && modifiedMessages.length === 0 && !isStreaming) {
			const timer = setTimeout(() => {
				setShowCheckpointWarning(true)
			}, 5000) // 5 seconds

			return () => clearTimeout(timer)
		}
	}, [task, modifiedMessages.length, isStreaming])

	// Effect to hide the checkpoint warning when messages appear
	useEffect(() => {
		if (modifiedMessages.length > 0 || isStreaming) {
			setShowCheckpointWarning(false)
		}
	}, [modifiedMessages.length, isStreaming])

	// Checkpoint warning component
	const CheckpointWarningMessage = useCallback(
		() => (
			<div className="flex items-center p-3 my-3 bg-vscode-inputValidation-warningBackground border border-vscode-inputValidation-warningBorder rounded">
				<span className="codicon codicon-loading codicon-modifier-spin mr-2" />
				<span className="text-vscode-foreground">
					Still initializing checkpoint... If this takes too long, you can{" "}
					<VSCodeLink
						href="#"
						onClick={(e) => {
							e.preventDefault()
							window.postMessage({ type: "action", action: "settingsButtonClicked" }, "*")
						}}
						className="inline px-0.5">
						disable checkpoints in settings
					</VSCodeLink>{" "}
					and restart your task.
				</span>
			</div>
		),
		[],
	)

	const baseText = task ? t("chat:typeMessage") : t("chat:typeTask")
	const placeholderText =
		baseText +
		`\n(${t("chat:addContext")}${shouldDisableImages ? `, ${t("chat:dragFiles")}` : `, ${t("chat:dragFilesImages")}`})`

	const itemContent = useCallback(
		(index: number, messageOrGroup: ClineMessage | ClineMessage[]) => {
			// browser session group
			if (Array.isArray(messageOrGroup)) {
				return (
					<BrowserSessionRow
						messages={messageOrGroup}
						isLast={index === messages.length - 1}
						lastModifiedMessage={modifiedMessages.at(-1)}
						onHeightChange={handleRowHeightChange}
						isStreaming={isStreaming}
						// Pass handlers for each message in the group
						isExpanded={(messageTs: number) => expandedRows[messageTs] ?? false}
						onToggleExpand={(messageTs: number) => {
							setExpandedRows((prev) => ({
								...prev,
								[messageTs]: !prev[messageTs],
							}))
						}}
					/>
				)
			}

			// regular message
			return (
				<ChatRow
					key={messageOrGroup.ts}
					message={messageOrGroup}
					isExpanded={expandedRows[messageOrGroup.ts] || false}
					onToggleExpand={() => toggleRowExpansion(messageOrGroup.ts)}
					lastModifiedMessage={modifiedMessages.at(-1)}
					isLast={index === messages.length - 1}
					onHeightChange={handleRowHeightChange}
					isStreaming={isStreaming}
				/>
			)
		},
		[
			expandedRows,
			messages,
			handleRowHeightChange,
			isStreaming,
			toggleRowExpansion,
		],
	)

	useEffect(() => {
		// Only proceed if we have an ask and buttons are enabled
		if (!clineAsk || !enableButtons) return

		const autoApprove = async () => {
			if (isAutoApproved(lastMessage)) {
				// Add delay for write operations
				if (lastMessage?.ask === "tool" && isWriteToolAction(lastMessage)) {
					await new Promise((resolve) => setTimeout(resolve, writeDelayMs))
				}
				handlePrimaryButtonClick()
			}
		}
		autoApprove()
	}, [
		clineAsk,
		enableButtons,
		handlePrimaryButtonClick,
		alwaysAllowBrowser,
		alwaysAllowReadOnly,
		alwaysAllowWrite,
		alwaysAllowExecute,
		alwaysAllowMcp,
		messages,
		allowedCommands,
		mcpServers,
		isAutoApproved,
		lastMessage,
		writeDelayMs,
		isWriteToolAction,
	])

	// Function to handle mode switching
	const switchToNextMode = useCallback(() => {
		const allModes = getAllModes(customModes)
		const currentModeIndex = allModes.findIndex((m) => m.slug === mode)
		const nextModeIndex = (currentModeIndex + 1) % allModes.length
		// Update local state and notify extension to sync mode change
		setMode(allModes[nextModeIndex].slug)
		vscode.postMessage({
			type: "mode",
			text: allModes[nextModeIndex].slug,
		})
	}, [mode, setMode, customModes])

	// Add keyboard event handler
	const handleKeyDown = useCallback(
		(event: KeyboardEvent) => {
			// Check for Command + . (period)
			if ((event.metaKey || event.ctrlKey) && event.key === ".") {
				event.preventDefault() // Prevent default browser behavior
				switchToNextMode()
			}
		},
		[switchToNextMode],
	)

	// Add event listener
	useEffect(() => {
		window.addEventListener("keydown", handleKeyDown)
		return () => {
			window.removeEventListener("keydown", handleKeyDown)
		}
	}, [handleKeyDown])

	// Reset TTS state when task changes
	useEffect(() => {
		console.log(`TTS Debug - Reset TTS state due to task change`);
		setIsTtsSpeaking(false);
		ttsPendingRef.current = false;
		ttsPlayedMessages.current.clear();
		lastSpokenContentRef.current = "";
		streamingContentRef.current = "";
		lastTtsSentChunkRef.current = "";
	}, [task]);

	const isBrowserSessionMessage = (message: ClineMessage): boolean => {
		// which of visible messages are browser session messages, see above
		if (message.type === "ask") {
			return ["browser_action_launch"].includes(message.ask!)
		}
		if (message.type === "say") {
			return ["api_req_started", "text", "browser_action", "browser_action_result"].includes(message.say!)
		}
		return false
	}

	// Initialize groupedMessages and update the ref when it changes
	const groupedMessages = useMemo(() => {
		const result: (ClineMessage | ClineMessage[])[] = []
		let currentGroup: ClineMessage[] = []
		let isInBrowserSession = false

		const endBrowserSession = () => {
			if (currentGroup.length > 0) {
				result.push([...currentGroup])
				currentGroup = []
				isInBrowserSession = false
			}
		}

		visibleMessages.forEach((message) => {
			if (message.ask === "browser_action_launch") {
				// complete existing browser session if any
				endBrowserSession()
				// start new
				isInBrowserSession = true
				currentGroup.push(message)
			} else if (isInBrowserSession) {
				// end session if api_req_started is cancelled

				if (message.say === "api_req_started") {
					// get last api_req_started in currentGroup to check if it's cancelled. If it is then this api req is not part of the current browser session
					const lastApiReqStarted = [...currentGroup].reverse().find((m) => m.say === "api_req_started")
					if (lastApiReqStarted?.text !== null && lastApiReqStarted?.text !== undefined) {
						const info = JSON.parse(lastApiReqStarted.text)
						const isCancelled = info.cancelReason !== null && info.cancelReason !== undefined
						if (isCancelled) {
							endBrowserSession()
							result.push(message)
							return
						}
					}
				}

				if (isBrowserSessionMessage(message)) {
					currentGroup.push(message)

					// Check if this is a close action
					if (message.say === "browser_action") {
						const browserAction = JSON.parse(message.text || "{}") as ClineSayBrowserAction
						if (browserAction.action === "close") {
							endBrowserSession()
						}
					}
				} else {
					// complete existing browser session if any
					endBrowserSession()
					result.push(message)
				}
			} else {
				result.push(message)
			}
		})

		// Handle case where browser session is the last group
		if (currentGroup.length > 0) {
			result.push([...currentGroup])
		}

		// Update the ref with the new value
		groupedMessagesRef.current = result;
		return result;
	}, [visibleMessages])

	return (
		<div
			style={{
				position: "fixed",
				top: 0,
				left: 0,
				right: 0,
				bottom: 0,
				display: isHidden ? "none" : "flex",
				flexDirection: "column",
				overflow: "hidden",
			}}>
			{task ? (
				<>
					<TaskHeader
						task={task}
						tokensIn={apiMetrics.totalTokensIn}
						tokensOut={apiMetrics.totalTokensOut}
						doesModelSupportPromptCache={selectedModelInfo.supportsPromptCache}
						cacheWrites={apiMetrics.totalCacheWrites}
						cacheReads={apiMetrics.totalCacheReads}
						totalCost={apiMetrics.totalCost}
						contextTokens={apiMetrics.contextTokens}
						onClose={handleTaskCloseButtonClick}
					/>

					{/* Checkpoint warning message */}
					{showCheckpointWarning && (
						<div className="px-3">
							<CheckpointWarningMessage />
						</div>
					)}
				</>
			) : (
				<div
					style={{
						flex: "1 1 0", // flex-grow: 1, flex-shrink: 1, flex-basis: 0
						minHeight: 0,
						overflowY: "auto",
						display: "flex",
						flexDirection: "column",
						paddingBottom: "10px",
					}}>
					{telemetrySetting === "unset" && <TelemetryBanner />}
					{showAnnouncement && <Announcement version={version} hideAnnouncement={hideAnnouncement} />}
					<div style={{ padding: "0 20px", flexShrink: 0 }}>
						<h2>{t("chat:greeting")}</h2>
						<p>{t("chat:aboutMe")}</p>
					</div>
					{taskHistory.length > 0 && <HistoryPreview showHistoryView={showHistoryView} />}
				</div>
			)}

			{/* 
			// Flex layout explanation:
			// 1. Content div above uses flex: "1 1 0" to:
			//    - Grow to fill available space (flex-grow: 1) 
			//    - Shrink when AutoApproveMenu needs space (flex-shrink: 1)
			//    - Start from zero size (flex-basis: 0) to ensure proper distribution
			//    minHeight: 0 allows it to shrink below its content height
			//
			// 2. AutoApproveMenu uses flex: "0 1 auto" to:
			//    - Not grow beyond its content (flex-grow: 0)
			//    - Shrink when viewport is small (flex-shrink: 1) 
			//    - Use its content size as basis (flex-basis: auto)
			//    This ensures it takes its natural height when there's space
			//    but becomes scrollable when the viewport is too small
			*/}
			{!task && (
				<AutoApproveMenu
					style={{
						marginBottom: -2,
						flex: "0 1 auto", // flex-grow: 0, flex-shrink: 1, flex-basis: auto
						minHeight: 0,
					}}
				/>
			)}

			{task && (
				<>
					<div style={{ flexGrow: 1, display: "flex" }} ref={scrollContainerRef}>
						<Virtuoso
							ref={virtuosoRef}
							key={task.ts} // trick to make sure virtuoso re-renders when task changes, and we use initialTopMostItemIndex to start at the bottom
							className="scrollable"
							style={{
								flexGrow: 1,
								overflowY: "scroll", // always show scrollbar
							}}
							components={{
								Footer: () => <div style={{ height: 5 }} />, // Add empty padding at the bottom
							}}
							// increasing top by 3_000 to prevent jumping around when user collapses a row
							increaseViewportBy={{ top: 3_000, bottom: Number.MAX_SAFE_INTEGER }} // hack to make sure the last message is always rendered to get truly perfect scroll to bottom animation when new messages are added (Number.MAX_SAFE_INTEGER is safe for arithmetic operations, which is all virtuoso uses this value for in src/sizeRangeSystem.ts)
							data={groupedMessages} // messages is the raw format returned by extension, modifiedMessages is the manipulated structure that combines certain messages of related type, and visibleMessages is the filtered structure that removes messages that should not be rendered
							itemContent={itemContent}
							atBottomStateChange={(isAtBottom) => {
								setIsAtBottom(isAtBottom)
								if (isAtBottom) {
									disableAutoScrollRef.current = false
								}
								setShowScrollToBottom(disableAutoScrollRef.current && !isAtBottom)
							}}
							atBottomThreshold={10} // anything lower causes issues with followOutput
							initialTopMostItemIndex={groupedMessages.length - 1}
						/>
					</div>
					<AutoApproveMenu />
					{showScrollToBottom ? (
						<div
							style={{
								display: "flex",
								padding: "10px 15px 0px 15px",
							}}>
							<ScrollToBottomButton
								onClick={() => {
									scrollToBottomSmooth()
									disableAutoScrollRef.current = false
								}}
								title={t("chat:scrollToBottom")}>
								<span className="codicon codicon-chevron-down" style={{ fontSize: "18px" }}></span>
							</ScrollToBottomButton>
						</div>
					) : (
						<div
							style={{
								opacity:
									primaryButtonText || secondaryButtonText || isStreaming
										? enableButtons || (isStreaming && !didClickCancel)
											? 1
											: 0.5
										: 0,
								display: "flex",
								padding: `${primaryButtonText || secondaryButtonText || isStreaming ? "10" : "0"}px 15px 0px 15px`,
							}}>
							{primaryButtonText && !isStreaming && (
								<VSCodeButton
									appearance="primary"
									disabled={!enableButtons}
									style={{
										flex: secondaryButtonText ? 1 : 2,
										marginRight: secondaryButtonText ? "6px" : "0",
									}}
									title={
										primaryButtonText === t("chat:retry.title")
											? t("chat:retry.tooltip")
											: primaryButtonText === t("chat:save.title")
												? t("chat:save.tooltip")
												: primaryButtonText === t("chat:approve.title")
													? t("chat:approve.tooltip")
													: primaryButtonText === t("chat:runCommand.title")
														? t("chat:runCommand.tooltip")
														: primaryButtonText === t("chat:startNewTask.title")
															? t("chat:startNewTask.tooltip")
															: primaryButtonText === t("chat:resumeTask.title")
																? t("chat:resumeTask.tooltip")
																: primaryButtonText === t("chat:proceedAnyways.title")
																	? t("chat:proceedAnyways.tooltip")
																	: primaryButtonText ===
																		  t("chat:proceedWhileRunning.title")
																		? t("chat:proceedWhileRunning.tooltip")
																		: undefined
									}
									onClick={(e) => handlePrimaryButtonClick(inputValue, selectedImages)}>
									{primaryButtonText}
								</VSCodeButton>
							)}
							{(secondaryButtonText || isStreaming) && (
								<VSCodeButton
									appearance="secondary"
									disabled={!enableButtons && !(isStreaming && !didClickCancel)}
									style={{
										flex: isStreaming ? 2 : 1,
										marginLeft: isStreaming ? 0 : "6px",
									}}
									title={
										isStreaming
											? t("chat:cancel.tooltip")
											: secondaryButtonText === t("chat:startNewTask.title")
												? t("chat:startNewTask.tooltip")
												: secondaryButtonText === t("chat:reject.title")
													? t("chat:reject.tooltip")
													: secondaryButtonText === t("chat:terminate.title")
														? t("chat:terminate.tooltip")
														: undefined
									}
									onClick={(e) => handleSecondaryButtonClick(inputValue, selectedImages)}>
									{isStreaming ? t("chat:cancel.title") : secondaryButtonText}
								</VSCodeButton>
							)}
						</div>
					)}
				</>
			)}

			<ChatTextArea
				ref={textAreaRef}
				inputValue={inputValue}
				setInputValue={setInputValue}
				textAreaDisabled={textAreaDisabled}
				placeholderText={placeholderText}
				selectedImages={selectedImages}
				setSelectedImages={setSelectedImages}
				onSend={() => handleSendMessage(inputValue, selectedImages)}
				onSelectImages={selectImages}
				shouldDisableImages={shouldDisableImages}
				onHeightChange={() => {
					if (isAtBottom) {
						scrollToBottomAuto()
					}
				}}
				mode={mode}
				setMode={setMode}
				modeShortcutText={modeShortcutText}
			/>

			<div id="roo-portal" />
			<AudioPlayer />
		</div>
	)
}

const ScrollToBottomButton = styled.div`
	background-color: color-mix(in srgb, var(--vscode-toolbar-hoverBackground) 55%, transparent);
	border-radius: 3px;
	overflow: hidden;
	cursor: pointer;
	display: flex;
	justify-content: center;
	align-items: center;
	flex: 1;
	height: 25px;

	&:hover {
		background-color: color-mix(in srgb, var(--vscode-toolbar-hoverBackground) 90%, transparent);
	}

	&:active {
		background-color: color-mix(in srgb, var(--vscode-toolbar-hoverBackground) 70%, transparent);
	}
`

export default ChatView
