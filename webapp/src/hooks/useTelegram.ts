import { useEffect, useState } from "react";

declare global {
  interface Window {
    Telegram?: {
      WebApp: {
        ready: () => void;
        expand: () => void;
        close: () => void;
        initData: string;
        initDataUnsafe: {
          user?: {
            id: number;
            first_name: string;
            last_name?: string;
            username?: string;
            language_code?: string;
          };
          auth_date: number;
          hash: string;
        };
        colorScheme: "light" | "dark";
        themeParams: {
          bg_color?: string;
          text_color?: string;
          hint_color?: string;
          link_color?: string;
          button_color?: string;
          button_text_color?: string;
          secondary_bg_color?: string;
        };
        setHeaderColor: (color: string) => void;
        setBackgroundColor: (color: string) => void;
        MainButton: {
          text: string;
          color: string;
          textColor: string;
          isVisible: boolean;
          isActive: boolean;
          show: () => void;
          hide: () => void;
          onClick: (callback: () => void) => void;
          offClick: (callback: () => void) => void;
        };
        BackButton: {
          isVisible: boolean;
          show: () => void;
          hide: () => void;
          onClick: (callback: () => void) => void;
          offClick: (callback: () => void) => void;
        };
        HapticFeedback: {
          impactOccurred: (style: "light" | "medium" | "heavy" | "rigid" | "soft") => void;
          notificationOccurred: (type: "error" | "success" | "warning") => void;
          selectionChanged: () => void;
        };
      };
    };
  }
}

export function useTelegram() {
  const [isReady, setIsReady] = useState(false);
  const [initData, setInitData] = useState<string>("");
  const [colorScheme, setColorScheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    const tg = window.Telegram?.WebApp;

    if (tg) {
      // Signal that the app is ready
      tg.ready();
      // Expand to full height
      tg.expand();

      setInitData(tg.initData);
      setColorScheme(tg.colorScheme);
      setIsReady(true);

      // Apply theme colors to CSS variables
      const params = tg.themeParams;
      if (params.bg_color) {
        document.documentElement.style.setProperty("--tg-theme-bg-color", params.bg_color);
      }
      if (params.text_color) {
        document.documentElement.style.setProperty("--tg-theme-text-color", params.text_color);
      }
      if (params.hint_color) {
        document.documentElement.style.setProperty("--tg-theme-hint-color", params.hint_color);
      }
      if (params.link_color) {
        document.documentElement.style.setProperty("--tg-theme-link-color", params.link_color);
      }
      if (params.button_color) {
        document.documentElement.style.setProperty("--tg-theme-button-color", params.button_color);
      }
      if (params.button_text_color) {
        document.documentElement.style.setProperty("--tg-theme-button-text-color", params.button_text_color);
      }
      if (params.secondary_bg_color) {
        document.documentElement.style.setProperty("--tg-theme-secondary-bg-color", params.secondary_bg_color);
      }
    } else {
      // Running outside Telegram (development mode)
      console.log("Running outside Telegram WebApp");
      setIsReady(true);
    }
  }, []);

  return {
    isReady,
    initData,
    colorScheme,
    webApp: window.Telegram?.WebApp,
  };
}
