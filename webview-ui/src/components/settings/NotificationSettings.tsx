import { HTMLAttributes } from "react"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"
import { Bell } from "lucide-react"

import { SetCachedStateField } from "./types"
import { SectionHeader } from "./SectionHeader"
import { Section } from "./Section"

type NotificationSettingsProps = HTMLAttributes<HTMLDivElement> & {
	soundEnabled?: boolean
	soundVolume?: number
	autoSpeakEnabled?: boolean
	autoSpeakVoiceModel?: string
	setCachedStateField: SetCachedStateField<"soundEnabled" | "soundVolume" | "autoSpeakEnabled" | "autoSpeakVoiceModel">
}

export const NotificationSettings = ({
	soundEnabled,
	soundVolume,
	autoSpeakEnabled,
	autoSpeakVoiceModel,
	setCachedStateField,
	...props
}: NotificationSettingsProps) => {
	const { t } = useAppTranslation()
	return (
		<div {...props}>
			<SectionHeader>
				<div className="flex items-center gap-2">
					<Bell className="w-4" />
					<div>{t("settings:sections.notifications")}</div>
				</div>
			</SectionHeader>

			<Section>
				<div>
					<VSCodeCheckbox
						checked={soundEnabled}
						onChange={(e: any) => setCachedStateField("soundEnabled", e.target.checked)}
						data-testid="sound-enabled-checkbox">
						<span className="font-medium">{t("settings:notifications.sound.label")}</span>
					</VSCodeCheckbox>
					<p className="text-vscode-descriptionForeground text-sm mt-0">
						{t("settings:notifications.sound.description")}
					</p>
					{soundEnabled && (
						<div
							style={{
								marginLeft: 0,
								paddingLeft: 10,
								borderLeft: "2px solid var(--vscode-button-background)",
							}}>
							<div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
								<input
									type="range"
									min="0"
									max="1"
									step="0.01"
									value={soundVolume ?? 0.5}
									onChange={(e) => setCachedStateField("soundVolume", parseFloat(e.target.value))}
									className="h-2 focus:outline-0 w-4/5 accent-vscode-button-background"
									aria-label="Volume"
									data-testid="sound-volume-slider"
								/>
								<span style={{ minWidth: "35px", textAlign: "left" }}>
									{((soundVolume ?? 0.5) * 100).toFixed(0)}%
								</span>
							</div>
							<p className="text-vscode-descriptionForeground text-sm mt-1">
								{t("settings:notifications.sound.volumeLabel")}
							</p>
						</div>
					)}
				</div>

				<div className="mt-4">
					<VSCodeCheckbox
						checked={autoSpeakEnabled}
						onChange={(e: any) => setCachedStateField("autoSpeakEnabled", e.target.checked)}
						data-testid="auto-speak-enabled-checkbox">
						<span className="font-medium">{t("settings:notifications.autoSpeak.label")}</span>
					</VSCodeCheckbox>
					<p className="text-vscode-descriptionForeground text-sm mt-0">
						{t("settings:notifications.autoSpeak.description")}
					</p>
					{autoSpeakEnabled && (
						<div
							style={{
								marginLeft: 0,
								paddingLeft: 10,
								borderLeft: "2px solid var(--vscode-button-background)",
							}}>
							<div className="mt-2">
								<label className="font-medium block mb-1">{t("settings:notifications.autoSpeak.apiKeyLabel")}</label>
								<input
									type="password"
									placeholder="sk-..."
									className="p-2 rounded w-full bg-vscode-input-background text-vscode-input-foreground border border-vscode-input-border outline-none focus:border-vscode-focusBorder"
									onChange={(e) => {
										// Store API key in VSCode's secret storage
										vscode.postMessage({ 
											type: "storeSecret", 
											key: "openAiApiKey", 
											value: e.target.value 
										})
									}}
								/>
								<p className="text-vscode-descriptionForeground text-sm mt-1">
									{t("settings:notifications.autoSpeak.apiKeyDescription")}
								</p>
							</div>
							
							<div className="mt-2">
								<label className="font-medium block mb-1">{t("settings:notifications.autoSpeak.voiceModelLabel")}</label>
								<select
									value={autoSpeakVoiceModel || "alloy"}
									onChange={(e) => setCachedStateField("autoSpeakVoiceModel", e.target.value)}
									className="p-2 rounded w-full bg-vscode-input-background text-vscode-input-foreground border border-vscode-input-border outline-none focus:border-vscode-focusBorder">
									<option value="alloy">Alloy</option>
									<option value="ash">Ash</option>
									<option value="coral">Coral</option>
									<option value="echo">Echo</option>
									<option value="fable">Fable</option>
									<option value="onyx">Onyx</option>
									<option value="nova">Nova</option>
									<option value="sage">Sage</option>
									<option value="shimmer">Shimmer</option>
								</select>
								<p className="text-vscode-descriptionForeground text-sm mt-1">
									{t("settings:notifications.autoSpeak.voiceModelDescription")}
								</p>
							</div>
						</div>
					)}
				</div>
			</Section>
		</div>
	)
}
