import { useEffect, useState } from "react"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"
import { vscode } from "../../utils/vscode"

import { SetCachedStateField } from "./types"
import { SectionHeader } from "./SectionHeader"
import { Section } from "./Section"
import { HTMLAttributes } from "react"
import { Bell, VolumeX, Volume2, Volume1, Mic, CheckCircle, XCircle, AlertCircle, Edit, Key } from "lucide-react"

type NotificationSettingsProps = HTMLAttributes<HTMLDivElement> & {
	soundEnabled?: boolean
	soundVolume?: number
	autoSpeakEnabled?: boolean
	autoSpeakVoiceModel?: string
	setCachedStateField: SetCachedStateField<"soundEnabled" | "soundVolume" | "autoSpeakEnabled" | "autoSpeakVoiceModel">
}

// Voice models available in OpenAI TTS
const VOICE_MODELS = [
	{ value: "alloy", label: "Alloy", description: "Neutral" },
	{ value: "echo", label: "Echo", description: "Deep" },
	{ value: "fable", label: "Fable", description: "Expressive" },
	{ value: "onyx", label: "Onyx", description: "Authoritative" },
	{ value: "nova", label: "Nova", description: "Energetic" },
	{ value: "shimmer", label: "Shimmer", description: "Warm" },
	{ value: "ash", label: "Ash", description: "Balanced" },
	{ value: "coral", label: "Coral", description: "Friendly" },
	{ value: "sage", label: "Sage", description: "Calm" }
]

export const NotificationSettings = ({
	soundEnabled,
	soundVolume,
	autoSpeakEnabled,
	autoSpeakVoiceModel,
	setCachedStateField,
	...props
}: NotificationSettingsProps) => {
	const { t } = useAppTranslation()
	
	// State to track API key status
	const [apiKeyStatus, setApiKeyStatus] = useState("checking");
	const [apiKeyPlaceholder, setApiKeyPlaceholder] = useState("sk-...");
	const [showApiKeyInput, setShowApiKeyInput] = useState(false);
	
	// Check API key status on mount
	useEffect(() => {
		vscode.postMessage({ type: "checkTtsApiKey" });
		
		const handleMessage = (event: MessageEvent) => {
			const message = event.data;
			if (message.type === "ttsApiKeyStatus") {
				setApiKeyStatus(message.status);
				if (message.status === "available") {
					setApiKeyPlaceholder("Click to edit API key");
					setShowApiKeyInput(false);
				} else {
					setShowApiKeyInput(true);
				}
			}
		};
		
		window.addEventListener('message', handleMessage);
		return () => window.removeEventListener('message', handleMessage);
	}, []);

	// Get status icon based on API key status
	const getStatusIcon = () => {
		if (apiKeyStatus === "available") return <CheckCircle className="w-3 h-3 text-green-500" />;
		if (apiKeyStatus === "checking") return <AlertCircle className="w-3 h-3 text-yellow-500" />;
		return <XCircle className="w-3 h-3 text-red-500" />;
	};

	return (
		<div {...props} className="compact-settings">
			{/* Main Notifications Header */}
			<SectionHeader>
				<div className="flex items-center gap-2">
					<Bell className="w-4" />
					<div>{t("settings:sections.notifications")}</div>
				</div>
			</SectionHeader>

			<Section>
				{/* Sound Settings - Compact */}
				<div className="mb-4">
					<div className="flex items-center gap-1">
						{!soundEnabled ? <VolumeX className="w-3.5 h-3.5" /> : 
						 (soundVolume ?? 0) < 0.3 ? <Volume1 className="w-3.5 h-3.5" /> : 
						 <Volume2 className="w-3.5 h-3.5" />}
						<VSCodeCheckbox
							checked={soundEnabled}
							onChange={(e: any) => setCachedStateField("soundEnabled", e.target.checked)}
							data-testid="sound-enabled-checkbox">
							<span className="text-sm font-medium">{t("settings:notifications.sound.label")}</span>
						</VSCodeCheckbox>
					</div>
					
					{soundEnabled && (
						<div className="mt-1 ml-5 flex items-center gap-2">
							<input
								type="range"
								min="0"
								max="1"
								step="0.01"
								value={soundVolume ?? 0.5}
								onChange={(e) => setCachedStateField("soundVolume", parseFloat(e.target.value))}
								className="h-1.5 focus:outline-0 w-32 accent-vscode-button-background"
								aria-label="Volume"
							/>
							<span className="text-xs">{((soundVolume ?? 0.5) * 100).toFixed(0)}%</span>
						</div>
					)}
				</div>

				{/* AutoSpeak Header - Similar to Notifications Header */}
				<div className="bg-vscode-panel-background p-2 rounded-t border-t border-x border-vscode-panel-border flex items-center gap-2 mt-5">
					<Mic className="w-3.5 h-3.5" />
					<span className="text-sm font-medium">Text-to-Speech</span>
					
					{/* API Key Status on the right */}
					{autoSpeakEnabled && apiKeyStatus === "available" && (
						<div className="ml-auto flex items-center gap-1 text-xs">
							<CheckCircle className="w-3 h-3 text-green-500" />
							<span className="text-xs opacity-70">API Key OK</span>
						</div>
					)}
				</div>

				{/* AutoSpeak Content Section */}
				<div className="px-2 py-2 border-b border-x border-vscode-panel-border rounded-b">
					{/* Enable/Disable AutoSpeak Checkbox */}
					<div className="flex items-center gap-1">
						<VSCodeCheckbox
							checked={autoSpeakEnabled}
							onChange={(e: any) => setCachedStateField("autoSpeakEnabled", e.target.checked)}
							data-testid="auto-speak-enabled-checkbox">
							<span className="text-sm font-medium">{t("settings:notifications.autoSpeak.label")}</span>
						</VSCodeCheckbox>
						
						{/* API Key Edit Button (only when available) */}
						{autoSpeakEnabled && apiKeyStatus === "available" && !showApiKeyInput && (
							<button 
								className="ml-auto flex items-center gap-1 text-xs opacity-70 hover:opacity-100 focus:outline-none"
								onClick={() => setShowApiKeyInput(true)}
							>
								<Edit className="w-3 h-3" />
								<span>Edit Key</span>
							</button>
						)}
						
						{/* API Key Status (when not OK) */}
						{autoSpeakEnabled && apiKeyStatus !== "available" && (
							<div className="ml-auto flex items-center gap-1 text-xs">
								{getStatusIcon()}
								<span className="text-xs opacity-70">
									{apiKeyStatus === "checking" ? "Checking..." : "Key Required"}
								</span>
							</div>
						)}
					</div>
					
					{autoSpeakEnabled && (
						<div className="mt-2">
							{/* API Key Input */}
							{showApiKeyInput && (
								<div className="relative mb-3">
									<div className="flex items-center gap-1 mb-1">
										<Key className="w-3 h-3 opacity-70" />
										<span className="text-xs font-medium">OpenAI API Key</span>
									</div>
									<div className="flex w-full">
										<input
											type="password"
											placeholder="Enter OpenAI API key (starts with sk-...)"
											className="px-2 py-1 text-xs rounded-l w-full bg-vscode-input-background text-vscode-input-foreground border border-vscode-input-border outline-none focus:border-vscode-focusBorder"
											onChange={(e) => {
												const newKey = e.target.value;
												if (newKey && newKey.startsWith("sk-")) {
													vscode.postMessage({ 
														type: "storeSecret", 
														key: "openAiApiKey", 
														value: newKey
													});
													setApiKeyStatus("available");
													// Don't auto-hide input so they can see it was saved
												}
											}}
										/>
										{apiKeyStatus === "available" && (
											<button 
												className="px-2 rounded-r bg-vscode-button-background text-vscode-button-foreground text-xs"
												onClick={() => setShowApiKeyInput(false)}
											>
												Done
											</button>
										)}
									</div>
									{apiKeyStatus !== "available" && (
										<div className="text-[10px] text-vscode-errorForeground mt-1">
											OpenAI API key with TTS access required
										</div>
									)}
								</div>
							)}
							
							{/* Voice Selection Header */}
							<div className="flex items-center justify-between mb-1">
								<span className="text-xs font-medium">Voice Selection</span>
							</div>
							
							{/* Voice Selection - Horizontal Grid */}
							<div className="grid grid-cols-3 gap-1">
								{VOICE_MODELS.map(model => (
									<div 
										key={model.value}
										className={`px-2 py-1 rounded text-xs cursor-pointer ${
											autoSpeakVoiceModel === model.value ? 
											'bg-vscode-button-background text-vscode-button-foreground' : 
											'hover:bg-vscode-list-hoverBackground'
										}`}
										onClick={() => setCachedStateField("autoSpeakVoiceModel", model.value)}
									>
										<div className="flex items-center justify-between">
											<span className="font-medium">{model.label}</span>
											{autoSpeakVoiceModel === model.value && (
												<CheckCircle className="w-3 h-3" />
											)}
										</div>
										<div className="opacity-70 text-xs">{model.description}</div>
									</div>
								))}
							</div>
						</div>
					)}
				</div>
			</Section>
		</div>
	)
}
