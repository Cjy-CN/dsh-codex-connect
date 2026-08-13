window.__ModuleLoader__.load({
	id: "dsh-codex",
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
		const USAGE_POLL_INTERVAL_MS = 6e4;
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
		const quotaListStyle = {
			display: "flex",
			flexDirection: "column",
			gap: 18,
			paddingTop: 2
		};
		const quotaGroupStyle = {
			display: "flex",
			flexDirection: "column",
			gap: 10
		};
		const quotaTitleStyle = {
			margin: 0,
			fontSize: 14,
			lineHeight: "20px",
			fontWeight: 600,
			color: "var(--dsw-alias-label-primary)"
		};
		const quotaLabelStyle = {
			display: "flex",
			justifyContent: "space-between",
			gap: 12,
			fontSize: 13,
			lineHeight: "20px",
			color: "var(--dsw-alias-label-secondary)"
		};
		const progressTrackStyle = {
			height: 8,
			overflow: "hidden",
			borderRadius: 999,
			background: "var(--dsw-alias-bg-layer-2, rgba(0, 0, 0, 0.08))"
		};
		function progressFillStyle(percent) {
			return {
				width: `${Math.max(0, Math.min(100, percent))}%`,
				height: "100%",
				borderRadius: "inherit",
				background: "var(--dsw-alias-brand-primary, #1677ff)"
			};
		}
		function windowLabel(seconds, t) {
			if (seconds === 18e3) return t("fiveHourLimit");
			if (seconds === 604800) return t("weeklyLimit");
			const hours = seconds / 3600;
			return Number.isInteger(hours) ? t("hourLimit", { count: hours }) : t("usageWindow");
		}
		function formatPercent(percent) {
			return new Intl.NumberFormat(void 0, { maximumFractionDigits: 1 }).format(percent);
		}
		function QuotaBar({ label, percent, detail, t }) {
			const display = formatPercent(percent);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: quotaGroupStyle,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: quotaLabelStyle,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: label }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("percentRemaining", { percent: display }) })]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: progressTrackStyle,
						role: "progressbar",
						"aria-label": label,
						"aria-valuemin": 0,
						"aria-valuemax": 100,
						"aria-valuenow": percent,
						"aria-valuetext": t("percentRemaining", { percent: display }),
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { style: progressFillStyle(percent) })
					}),
					detail === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						style: bodyStyle,
						children: detail
					})
				]
			});
		}
		function UsageLimits({ usage, quotaError, t }) {
			const hasData = usage.rateLimits.length > 0 || usage.credits !== void 0 || usage.individualLimit !== void 0;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: quotaListStyle,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
						style: quotaTitleStyle,
						children: t("usageLimits")
					}),
					usage.rateLimits.map((limit) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: quotaGroupStyle,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h4", {
							style: quotaTitleStyle,
							children: limit.name ?? limit.id
						}), limit.windows.map((window) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(QuotaBar, {
							label: windowLabel(window.windowSeconds, t),
							percent: window.remainingPercent,
							t
						}, window.windowSeconds))]
					}, limit.id)),
					usage.individualLimit === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(QuotaBar, {
						label: t("monthlyLimit"),
						percent: usage.individualLimit.remainingPercent,
						detail: t("exactRemaining", {
							remaining: usage.individualLimit.remaining,
							limit: usage.individualLimit.limit
						}),
						t
					}),
					usage.credits === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: quotaLabelStyle,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("credits") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: usage.credits.unlimited ? t("unlimited") : usage.credits.balance === void 0 ? t("available") : usage.credits.balance })]
					}),
					!hasData && quotaError === void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						style: bodyStyle,
						children: t("quotaUnavailable")
					}) : null,
					quotaError === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						style: errorStyle,
						children: t("quotaUnavailable")
					})
				]
			});
		}
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
				const interval = status.status === "signing-in" ? POLL_INTERVAL_MS : status.status === "signed-in" ? USAGE_POLL_INTERVAL_MS : void 0;
				if (interval === void 0) return;
				const timer = window.setInterval(() => {
					refresh();
				}, interval);
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
			const label = status.status === "signed-in" ? t("signedIn") : status.status === "loading" ? t("loadingAccount") : status.status === "signing-in" ? t("signingIn") : status.status === "error" ? t("requestFailed") : t("signedOut");
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				style: pageStyle,
				"aria-labelledby": "openai-codex-settings-title",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
					id: "openai-codex-settings-title",
					style: titleStyle,
					children: t("title")
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					style: {
						...bodyStyle,
						marginTop: 6
					},
					children: t("intro")
				})] }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
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
							}), status.status === "loading" ? null : status.status === "signed-in" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
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
								disabled: busy,
								onClick: () => {
									signIn();
								},
								children: busy ? t("working") : status.status === "error" ? t("loginAgain") : t("login")
							})]
						}),
						status.status === "error" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							style: errorStyle,
							children: status.message
						}) : null,
						status.status === "signed-in" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(UsageLimits, {
							usage: status.usage,
							...status.quotaError === void 0 ? {} : { quotaError: status.quotaError },
							t
						}) : null
					]
				})]
			});
		}
		//#endregion
		//#region src/client/locales.ts
		/** English copy for the OpenAI Codex settings page. */
		const en = {
			nav: "OpenAI Codex",
			title: "OpenAI Codex",
			intro: "Use your ChatGPT subscription in dsh without an API key.",
			loadingAccount: "Loading account…",
			signedOut: "Not signed in",
			signingIn: "Waiting for browser authorization…",
			signedIn: "Signed in",
			login: "Sign in with ChatGPT",
			loginAgain: "Sign in again",
			logout: "Sign out",
			working: "Working…",
			retry: "Retry",
			popupBlocked: "The browser blocked the sign-in window. Allow pop-ups for this dsh page and retry.",
			usageLimits: "Usage limits",
			fiveHourLimit: "5-hour limit",
			weeklyLimit: "Weekly limit",
			hourLimit: "{count}-hour limit",
			usageWindow: "Usage window",
			percentRemaining: "{percent}% remaining",
			monthlyLimit: "Monthly credit limit",
			exactRemaining: "{remaining} of {limit} credits remaining",
			credits: "Credits",
			unlimited: "Unlimited",
			available: "Available",
			quotaUnavailable: "Usage limits are temporarily unavailable.",
			requestFailed: "The OpenAI Codex account request failed."
		};
		/** Chinese copy for the OpenAI Codex settings page. */
		const zh = {
			nav: "OpenAI Codex",
			title: "OpenAI Codex",
			intro: "使用 ChatGPT 订阅在 dsh 中调用模型，无需 API Key。",
			loadingAccount: "正在加载账户信息…",
			signedOut: "尚未登录",
			signingIn: "正在等待浏览器授权…",
			signedIn: "已登录",
			login: "使用 ChatGPT 登录",
			loginAgain: "重新登录",
			logout: "退出登录",
			working: "处理中…",
			retry: "重试",
			popupBlocked: "浏览器阻止了登录窗口。请允许此 dsh 页面弹出窗口后重试。",
			usageLimits: "使用额度",
			fiveHourLimit: "5 小时额度",
			weeklyLimit: "每周额度",
			hourLimit: "{count} 小时额度",
			usageWindow: "使用额度",
			percentRemaining: "剩余 {percent}%",
			monthlyLimit: "每月信用额度",
			exactRemaining: "剩余 {remaining} / {limit} credits",
			credits: "Credits",
			unlimited: "无限",
			available: "可用",
			quotaUnavailable: "暂时无法获取使用额度。",
			requestFailed: "OpenAI Codex 账户请求失败。"
		};
		//#endregion
		//#region src/client/index.tsx
		/** Stable browser-plugin name. */
		const name = "dsh-codex-client";
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
