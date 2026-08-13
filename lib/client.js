window.__ModuleLoader__.load({
	id: "@dsh-external/dsh-openai-codex",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/client/OpenAICodexSettings.tsx
		/** Plugin-owned OpenAI Codex account page inside the dsh Settings shell. */
		const STATUS_PATH = "/plugins/dsh-openai-codex/auth/status";
		const LOGIN_PATH = "/plugins/dsh-openai-codex/auth/login";
		const LOGOUT_PATH = "/plugins/dsh-openai-codex/auth/logout";
		const POLL_INTERVAL_MS = 1e3;
		const pageStyle = {
			display: "flex",
			flexDirection: "column",
			gap: 18,
			maxWidth: 720
		};
		const titleStyle = {
			margin: 0,
			fontSize: 20,
			lineHeight: "28px",
			fontWeight: 600,
			color: "var(--dsw-alias-label-primary)"
		};
		const bodyStyle = {
			margin: 0,
			fontSize: 14,
			lineHeight: "22px",
			color: "var(--dsw-alias-label-secondary)"
		};
		const cardStyle = {
			display: "flex",
			flexDirection: "column",
			gap: 14,
			padding: "18px 20px",
			border: "1px solid var(--dsw-alias-border-l2)",
			borderRadius: 12,
			background: "var(--dsw-alias-bg-module-platform)"
		};
		const rowStyle = {
			display: "flex",
			alignItems: "center",
			justifyContent: "space-between",
			flexWrap: "wrap",
			gap: 12
		};
		const statusStyle = {
			display: "flex",
			alignItems: "center",
			gap: 9,
			fontSize: 15,
			fontWeight: 500,
			color: "var(--dsw-alias-label-primary)"
		};
		const buttonStyle = {
			boxSizing: "border-box",
			minHeight: 34,
			padding: "6px 14px",
			border: "1px solid var(--dsw-alias-border-l2)",
			borderRadius: 18,
			background: "var(--dsw-alias-bg-layer-1)",
			color: "var(--dsw-alias-label-primary)",
			font: "inherit",
			fontSize: 14,
			cursor: "pointer"
		};
		const primaryButtonStyle = {
			...buttonStyle,
			borderColor: "var(--dsw-alias-brand-primary)",
			background: "var(--dsw-alias-brand-primary)",
			color: "white"
		};
		const errorStyle = {
			...bodyStyle,
			color: "var(--dsw-alias-state-error-primary)"
		};
		function dotStyle(status) {
			return {
				width: 9,
				height: 9,
				borderRadius: "50%",
				flex: "0 0 auto",
				background: status === "signed-in" ? "var(--dsw-alias-state-success-primary, #22a06b)" : status === "error" ? "var(--dsw-alias-state-error-primary, #d92d20)" : status === "signing-in" || status === "loading" ? "var(--dsw-alias-brand-primary, #1677ff)" : "var(--dsw-alias-label-dimmed, #9aa0a6)"
			};
		}
		async function jsonRequest(path, method = "GET") {
			const response = await fetch(path, {
				method,
				headers: { accept: "application/json" },
				credentials: "same-origin"
			});
			const value = await response.json().catch(() => void 0);
			if (!response.ok) {
				const message = typeof value === "object" && value !== null && "error" in value && typeof value.error === "string" ? value.error : `HTTP ${response.status}`;
				throw new Error(message);
			}
			return value;
		}
		/** OpenAI Codex account status and OAuth actions. */
		function OpenAICodexSettings({ t }) {
			if (t === void 0) throw new Error("OpenAI Codex settings requires its translation function");
			const [status, setStatus] = (0, react.useState)({ status: "loading" });
			const [busy, setBusy] = (0, react.useState)(false);
			const refresh = (0, react.useCallback)(async () => {
				try {
					setStatus(await jsonRequest(STATUS_PATH));
				} catch (error) {
					setStatus({
						status: "error",
						message: error instanceof Error ? error.message : t("requestFailed")
					});
				}
			}, [t]);
			(0, react.useEffect)(() => {
				refresh();
			}, [refresh]);
			(0, react.useEffect)(() => {
				if (status.status !== "signing-in") return;
				const timer = window.setInterval(() => {
					refresh();
				}, POLL_INTERVAL_MS);
				return () => {
					window.clearInterval(timer);
				};
			}, [refresh, status.status]);
			const signIn = async () => {
				const popup = window.open("about:blank", "_blank");
				if (popup !== null) popup.opener = null;
				setBusy(true);
				setStatus({ status: "signing-in" });
				try {
					const challenge = await jsonRequest(LOGIN_PATH, "POST");
					if (popup === null) {
						setStatus({
							status: "error",
							message: t("popupBlocked")
						});
						return;
					}
					popup.location.replace(challenge.url);
				} catch (error) {
					popup?.close();
					setStatus({
						status: "error",
						message: error instanceof Error ? error.message : t("requestFailed")
					});
				} finally {
					setBusy(false);
				}
			};
			const signOut = async () => {
				setBusy(true);
				try {
					await jsonRequest(LOGOUT_PATH, "POST");
					setStatus({ status: "signed-out" });
				} catch (error) {
					setStatus({
						status: "error",
						message: error instanceof Error ? error.message : t("requestFailed")
					});
				} finally {
					setBusy(false);
				}
			};
			const label = status.status === "signed-in" ? t("signedIn") : status.status === "signing-in" || status.status === "loading" ? t("signingIn") : status.status === "error" ? t("requestFailed") : t("signedOut");
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				style: pageStyle,
				"aria-labelledby": "openai-codex-settings-title",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
						id: "openai-codex-settings-title",
						style: titleStyle,
						children: t("title")
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						style: {
							...bodyStyle,
							marginTop: 6
						},
						children: t("intro")
					})] }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: cardStyle,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: rowStyle,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									style: statusStyle,
									role: "status",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										"aria-hidden": "true",
										style: dotStyle(status.status)
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: label })]
								}), status.status === "signed-in" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									style: buttonStyle,
									disabled: busy,
									onClick: () => {
										signOut();
									},
									children: busy ? t("working") : t("logout")
								}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									style: primaryButtonStyle,
									disabled: busy || status.status === "loading",
									onClick: () => {
										signIn();
									},
									children: busy ? t("working") : status.status === "error" ? t("loginAgain") : t("login")
								})]
							}),
							status.status === "signed-in" && status.expiresAt !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								style: bodyStyle,
								children: t("expires", { date: new Date(status.expiresAt).toLocaleString() })
							}) : null,
							status.status === "error" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								style: errorStyle,
								children: status.message
							}) : null,
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								style: bodyStyle,
								children: t("localOnly")
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: cardStyle,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							style: bodyStyle,
							children: t("features")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							style: bodyStyle,
							children: t("storage")
						})]
					})
				]
			});
		}
		//#endregion
		//#region src/client/locales.ts
		/** English copy for the OpenAI Codex settings page. */
		const en = {
			nav: "OpenAI Codex",
			title: "OpenAI Codex",
			intro: "Use your ChatGPT subscription in dsh without an API key.",
			signedOut: "Not signed in",
			signingIn: "Waiting for browser authorization…",
			signedIn: "Signed in",
			expires: "Current access expires {date}. The plugin refreshes it automatically.",
			login: "Sign in with ChatGPT",
			loginAgain: "Sign in again",
			logout: "Sign out",
			working: "Working…",
			retry: "Retry",
			popupBlocked: "The browser blocked the sign-in window. Allow pop-ups for this dsh page and retry.",
			localOnly: "Browser sign-in is available only when this page is opened from the same computer as dsh. The CLI login remains available for remote deployments.",
			features: "This provider includes Codex models, standalone web search, pasted image input, and the view_image tool for local paths or HTTP(S) URLs.",
			storage: "The credential is stored under the dsh home directory and is separate from the Codex CLI credential.",
			requestFailed: "The OpenAI Codex account request failed."
		};
		/** Chinese copy for the OpenAI Codex settings page. */
		const zh = {
			nav: "OpenAI Codex",
			title: "OpenAI Codex",
			intro: "使用 ChatGPT 订阅在 dsh 中调用模型，无需 API Key。",
			signedOut: "尚未登录",
			signingIn: "正在等待浏览器授权…",
			signedIn: "已登录",
			expires: "当前访问凭证将在 {date} 到期，插件会自动刷新。",
			login: "使用 ChatGPT 登录",
			loginAgain: "重新登录",
			logout: "退出登录",
			working: "处理中…",
			retry: "重试",
			popupBlocked: "浏览器阻止了登录窗口。请允许此 dsh 页面弹出窗口后重试。",
			localOnly: "仅当此页面与 dsh 运行在同一台电脑时才能从浏览器登录；远程部署仍可使用 CLI 登录。",
			features: "此提供方包含 Codex 模型、独立联网搜索、粘贴图片输入，以及可读取本地路径或 HTTP(S) URL 的 view_image 工具。",
			storage: "凭证保存在 dsh 主目录下，与 Codex CLI 的凭证相互独立。",
			requestFailed: "OpenAI Codex 账户请求失败。"
		};
		//#endregion
		//#region src/client/index.tsx
		/** Stable browser-plugin name. */
		const name = "dsh-openai-codex-client";
		/** Client services required by the settings contribution. */
		const inject = ["slots", "locale"];
		/** Register account copy and the OpenAI Codex settings page. */
		function apply(ctx) {
			const namespace = "settings.openai-codex";
			ctx.effect(() => ctx.locale.register(namespace, {
				zh,
				en
			}), "dsh-openai-codex: settings copy");
			const t = ctx.locale.bind(namespace);
			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "openai-codex",
				order: 15,
				label: () => t("nav"),
				inject: () => ({ t })
			}, OpenAICodexSettings));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		exports.name = name;
		return module.exports;
	}
});
