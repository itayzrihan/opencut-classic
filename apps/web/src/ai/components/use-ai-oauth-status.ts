"use client";

import { useCallback, useEffect, useState } from "react";

export interface AiOAuthStatus {
	authenticated: boolean;
	identity: {
		accountId?: string;
		email?: string;
		chatgptPlanType?: string;
		profileName?: string;
	} | null;
	error?: string;
}

export function useAiOAuthStatus() {
	const [status, setStatus] = useState<AiOAuthStatus>({
		authenticated: false,
		identity: null,
	});
	const [isLoading, setIsLoading] = useState(true);

	const refresh = useCallback(async () => {
		setIsLoading(true);
		try {
			const response = await fetch("/api/ai/oauth/status");
			const data: unknown = await response.json();
			setStatus(normalizeAiOAuthStatus(data));
		} catch (error) {
			setStatus({
				authenticated: false,
				identity: null,
				error:
					error instanceof Error
						? error.message
						: "Failed to read AI login status",
			});
		} finally {
			setIsLoading(false);
		}
	}, []);

	useEffect(() => {
		const timeoutId = window.setTimeout(() => {
			void refresh();
		}, 0);
		return () => window.clearTimeout(timeoutId);
	}, [refresh]);

	const login = useCallback(() => {
		const returnTo = encodeURIComponent(window.location.href);
		window.location.href = `/api/ai/oauth/start?returnTo=${returnTo}`;
	}, []);

	const logout = useCallback(async () => {
		await fetch("/api/ai/oauth/logout", { method: "POST" });
		await refresh();
	}, [refresh]);

	return { status, isLoading, refresh, login, logout };
}

function normalizeAiOAuthStatus(value: unknown): AiOAuthStatus {
	if (!isRecord(value)) {
		return { authenticated: false, identity: null };
	}
	return {
		authenticated: value.authenticated === true,
		identity: isRecord(value.identity)
			? {
					accountId:
						typeof value.identity.accountId === "string"
							? value.identity.accountId
							: undefined,
					email:
						typeof value.identity.email === "string"
							? value.identity.email
							: undefined,
					chatgptPlanType:
						typeof value.identity.chatgptPlanType === "string"
							? value.identity.chatgptPlanType
							: undefined,
					profileName:
						typeof value.identity.profileName === "string"
							? value.identity.profileName
							: undefined,
				}
			: null,
		error: typeof value.error === "string" ? value.error : undefined,
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}
