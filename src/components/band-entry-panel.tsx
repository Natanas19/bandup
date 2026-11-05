import { useId } from "react";

export type BandEntryState = "loading" | "empty" | "error" | "unavailable";

const disabledButton = "min-h-11 rounded-xl border border-nav-border bg-disabled-surface px-5 py-3 text-sm font-semibold text-content-subtle disabled:cursor-not-allowed";

// Presentation only: no records, network adapter or mutation callbacks until validation.
export default function BandEntryPanel({ admin = false, state = "unavailable" }: {
  admin?: boolean;
  state?: BandEntryState;
}) {
  const descriptionId = useId();
  const nameId = useId();
  const title = state === "loading" ? "Carregando..."
    : state === "error" ? "Não foi possível carregar agora"
    : state === "empty" ? admin ? "Nenhuma solicitação pendente" : "Nenhuma banda encontrada"
    : admin ? "Solicitações ainda indisponíveis" : "A descoberta está chegando";
  const message = state === "loading" ? "Aguarde enquanto esta área é carregada."
    : state === "error" ? "Tente abrir esta página novamente mais tarde. Nenhuma ação foi concluída."
    : state === "empty" ? admin ? "Novos pedidos aparecerão aqui quando estiverem disponíveis." : "Quando houver bandas disponíveis para descoberta, elas aparecerão aqui."
    : "Estamos validando a segurança desta funcionalidade antes de liberar seu uso.";

  return <section aria-label={admin ? "Solicitações de entrada" : "Descoberta de bandas"}
    aria-busy={state === "loading"} className="mt-7 space-y-5">
    <div className="rounded-2xl border border-accent-border bg-accent-soft p-5 sm:p-6">
      <p className="text-xs font-semibold uppercase tracking-widest text-accent">Em preparação</p>
      <p id={descriptionId} className="mt-2 text-sm leading-6 text-content-muted">
        {admin ? "Aprovar e recusar pedidos ficará disponível após a validação da funcionalidade."
          : "Buscar bandas e enviar pedidos ficará disponível após a validação da funcionalidade."}
        {" "}Por enquanto, nenhuma solicitação pode ser enviada ou decidida por esta área.
      </p>
    </div>
    <div className="grid min-w-0 gap-5 lg:grid-cols-5">
      <div className="rounded-2xl border border-nav-border bg-surface p-6 shadow-app-card sm:p-8 lg:col-span-3">
        <div role={state === "error" ? "alert" : "status"} className="py-6 text-center sm:py-10">
          <span aria-hidden="true" className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-accent-soft text-2xl text-accent">{admin ? "↗" : "♪"}</span>
          <h2 className="mt-5 text-xl font-semibold tracking-tight text-content">{title}</h2>
          <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-content-muted">{message}</p>
        </div>
        {admin && <div className="flex flex-col gap-3 border-t border-nav-border pt-5 sm:flex-row">
          <button type="button" disabled aria-describedby={descriptionId} className={disabledButton}>Aprovar entrada</button>
          <button type="button" disabled aria-describedby={descriptionId} className={disabledButton}>Recusar pedido</button>
        </div>}
      </div>
      <aside className="min-w-0 rounded-2xl border border-nav-border bg-surface p-6 sm:p-7 lg:col-span-2">
        <h2 className="text-lg font-semibold text-content">{admin ? "Você decide quem entra" : "Seu próximo encontro musical"}</h2>
        <p className="mt-3 text-sm leading-6 text-content-muted">{admin
          ? "Os pedidos serão exibidos com o nome informado pelo músico. Esse nome não comprova sua identidade. Ao aprovar, ele entrará como membro."
          : "Encontre uma banda que combine com você, conheça sua apresentação e solicite uma oportunidade. A entrada depende da aprovação de um administrador."}</p>
        {!admin && <div className="mt-6 space-y-3">
          <label htmlFor={nameId} className="block text-sm font-semibold text-content">Nome para apresentação</label>
          <input id={nameId} type="text" disabled maxLength={80} autoComplete="off"
            placeholder="Disponível ao escolher uma banda" aria-describedby={descriptionId}
            className="min-h-11 w-full min-w-0 rounded-xl border border-nav-border bg-disabled-surface px-4 py-3 text-sm text-content-subtle placeholder:text-content-subtle disabled:cursor-not-allowed" />
          <button type="button" disabled aria-describedby={descriptionId} className={`${disabledButton} w-full`}>Solicitar entrada</button>
          <p className="text-xs leading-5 text-content-subtle">Nenhuma banda foi selecionada. O envio ainda não está disponível.</p>
        </div>}
        {admin && <p className="mt-5 border-t border-nav-border pt-5 text-sm leading-6 text-content-subtle">Os integrantes atuais continuam listados nesta página.</p>}
      </aside>
    </div>
  </section>;
}
