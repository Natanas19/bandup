export default function DebugMobilePage() {
  return (
    <main className="min-h-screen p-6">
      <script
        dangerouslySetInnerHTML={{
          __html: `(function () {
            var panel = document.createElement("section");
            var title = document.createElement("h1");
            var log = document.createElement("pre");
            var count = 0;

            title.textContent = "CAPTURA NATIVA ATIVA";
            log.textContent = "Nenhum erro capturado até agora.";
            log.style.whiteSpace = "pre-wrap";
            log.style.wordWrap = "break-word";
            panel.setAttribute("role", "status");
            panel.appendChild(title);
            panel.appendChild(log);

            function report(type, message, source, line, column) {
              count += 1;
              if (count === 1) log.textContent = "";
              log.textContent += "#" + count + " " + type +
                "\\nMensagem: " + (message || "indisponível") +
                "\\nArquivo/source: " + (source || "indisponível") +
                "\\nLinha: " + (line == null ? "indisponível" : line) +
                "\\nColuna: " + (column == null ? "indisponível" : column) + "\\n\\n";
            }

            window.onerror = function (message, source, line, column) {
              report("window.onerror", String(message), source, line, column);
              return false;
            };

            window.addEventListener("error", function (event) {
              var target = event.target;
              if (target && target.tagName && target.tagName.toLowerCase() === "script") {
                report("Falha de recurso SCRIPT", "Falha ao carregar script", target.src || target.getAttribute("src"));
              } else if (target === window) {
                report("Evento error", event.message, event.filename, event.lineno, event.colno);
              }
            }, true);

            window.addEventListener("unhandledrejection", function (event) {
              var reason = event.reason;
              report("unhandledrejection", reason && reason.message ? reason.message : String(reason),
                reason && (reason.fileName || reason.sourceURL),
                reason && reason.lineNumber, reason && reason.columnNumber);
              if (reason && reason.stack) log.textContent += "Stack: " + reason.stack + "\\n\\n";
            });

            var script = document.currentScript;
            script.parentNode.insertBefore(panel, script);
          }());`,
        }}
      />
    </main>
  );
}
