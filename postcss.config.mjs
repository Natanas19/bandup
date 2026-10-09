const config = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {
      // CSS prefixes for the supported iPhone; Next.js keeps its own JS targets.
      overrideBrowserslist: ["defaults", "safari >= 15", "ios_saf >= 15"],
    },
  },
};

export default config;
