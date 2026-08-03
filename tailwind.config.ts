import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        cogri: {
          red: "#20a7d8",
          navy: "#07182f",
          ink: "#10233f",
          mist: "#eef3f8"
        }
      }
    }
  },
  plugins: []
};

export default config;
