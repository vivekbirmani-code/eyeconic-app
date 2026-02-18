import { useEffect, useRef, useCallback } from 'react';
import { AppState, AppStateStatus } from 'react-native';

/**
 * useAppRefresh — calls `onRefresh` whenever the app comes back to the foreground.
 * Also returns a `refresh` function for manual triggering.
 */
export function useAppRefresh(onRefresh: () => void) {
    const appState = useRef(AppState.currentState);
    const stableRefresh = useRef(onRefresh);

    // Keep ref up-to-date without re-subscribing AppState
    useEffect(() => {
        stableRefresh.current = onRefresh;
    });

    useEffect(() => {
        const sub = AppState.addEventListener('change', (nextState: AppStateStatus) => {
            if (
                appState.current.match(/inactive|background/) &&
                nextState === 'active'
            ) {
                stableRefresh.current();
            }
            appState.current = nextState;
        });
        return () => sub.remove();
    }, []); // empty deps — only subscribe once
}
