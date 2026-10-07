export default function DebugMobilePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
      <p id="debug-mobile-status" role="status" suppressHydrationWarning>
        JavaScript ainda não executou
      </p>
      <button
        id="debug-mobile-button"
        type="button"
        className="rounded-lg bg-violet-700 px-4 py-2 font-semibold text-white"
      >
        Testar clique
      </button>
      <script
        dangerouslySetInnerHTML={{
          __html: `(function () {
            var status = document.getElementById("debug-mobile-status");
            var button = document.getElementById("debug-mobile-button");
            status.textContent = "JavaScript nativo executou";
            button.addEventListener("click", function () {
              status.textContent = "JavaScript nativo e clique funcionaram";
            });
          }());`,
        }}
      />
    </main>
  );
}
