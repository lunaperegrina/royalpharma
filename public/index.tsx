import { useEffect, useMemo, useState, type FormEvent } from "react"
import { createRoot } from "react-dom/client"
import "./index.css"

type VerifyCodeForm = {
	uuid: string
	code: string
}

type VerifyCodeResponse = {
	success?: true
	message?: string
	error?: string
	code?: string
}

type FeedbackState = {
	kind: "success" | "error"
	message: string
}

type InitialContext = {
	source: string
	uuid: string
}

type ValidationStep = "identify" | "code" | "confirm" | "success"

type NdefRecordData = DataView | null | undefined

type NdefRecord = {
	recordType?: string
	data?: NdefRecordData
	encoding?: string
	mediaType?: string
}

type NdefMessage = {
	records: NdefRecord[]
}

type NdefReadingEvent = Event & {
	message: NdefMessage
}

type NdefReaderInstance = {
	scan: () => Promise<void>
	addEventListener: (
		type: "reading" | "readingerror",
		listener: (event: Event) => void,
		options?: AddEventListenerOptions,
	) => void
}

type WindowWithNdef = Window & {
	NDEFReader?: new () => NdefReaderInstance
}

const initialFormState: VerifyCodeForm = {
	uuid: "",
	code: "",
}

const uuidPattern =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function getInitialContext(): InitialContext {
	const searchParams = new URLSearchParams(window.location.search)

	return {
		source: searchParams.get("source")?.trim() || "direct",
		uuid: searchParams.get("uuid")?.trim() || "",
	}
}

function decodeRecordData(record: NdefRecord): string {
	if (!record.data) {
		return ""
	}

	const bytes = new Uint8Array(
		record.data.buffer,
		record.data.byteOffset,
		record.data.byteLength,
	)

	return new TextDecoder(record.encoding || "utf-8").decode(bytes).trim()
}

function extractUuidFromPayload(payload: string): string | null {
	const normalizedPayload = payload.trim()

	if (uuidPattern.test(normalizedPayload)) {
		return normalizedPayload
	}

	try {
		const parsedUrl = new URL(normalizedPayload)
		const uuidFromQuery = parsedUrl.searchParams.get("uuid")?.trim() || ""
		return uuidPattern.test(uuidFromQuery) ? uuidFromQuery : null
	} catch {
		return null
	}
}

function getUuidFromNdefMessage(message: NdefMessage): string | null {
	for (const record of message.records) {
		if (record.recordType === "empty") {
			continue
		}

		const decodedValue = decodeRecordData(record)

		if (!decodedValue) {
			continue
		}

		const extractedUuid = extractUuidFromPayload(decodedValue)

		if (extractedUuid) {
			return extractedUuid
		}
	}

	return null
}

function syncUrl(uuid: string, source: string) {
	const nextUrl = new URL(window.location.href)

	if (uuid.trim()) {
		nextUrl.searchParams.set("uuid", uuid.trim())
	} else {
		nextUrl.searchParams.delete("uuid")
	}

	if (source.trim() && source !== "direct") {
		nextUrl.searchParams.set("source", source)
	} else {
		nextUrl.searchParams.delete("source")
	}

	window.history.replaceState({}, "", nextUrl)
}

export function App() {
	const initialContext = useMemo(() => getInitialContext(), [])
	const [form, setForm] = useState<VerifyCodeForm>({
		...initialFormState,
		uuid: initialContext.uuid,
	})
	const [source, setSource] = useState(initialContext.source)
	const [feedback, setFeedback] = useState<FeedbackState | null>(null)
	const [isSubmitting, setIsSubmitting] = useState(false)
	const [isConfirmOpen, setIsConfirmOpen] = useState(false)
	const [isSuccessLocked, setIsSuccessLocked] = useState(false)
	const [isScanning, setIsScanning] = useState(false)
	const [nfcHint, setNfcHint] = useState("Aproxime o cartao NFC para identificar o produto.")
	const supportsWebNfc =
		typeof window !== "undefined" &&
		window.isSecureContext &&
		"NDEFReader" in (window as WindowWithNdef)

	const currentStep: ValidationStep = isSuccessLocked
		? "success"
		: isConfirmOpen
			? "confirm"
			: form.uuid.trim()
				? "code"
				: "identify"

	const isConfirmDisabled =
		isSubmitting || isSuccessLocked || !form.uuid.trim() || !form.code.trim()

	useEffect(() => {
		syncUrl(form.uuid, source)
	}, [form.uuid, source])

	function updateField(field: keyof VerifyCodeForm, value: string) {
		setForm((current) => ({
			...current,
			[field]: value,
		}))
	}

	function handleUuidChange(value: string) {
		updateField("uuid", value)
		if (value.trim()) {
			setSource("manual")
		}
		if (!value.trim()) {
			setIsSuccessLocked(false)
		}
	}

	function resetForAnotherValidation() {
		setForm((current) => ({
			...current,
			code: "",
		}))
		setFeedback(null)
		setIsConfirmOpen(false)
		setIsSuccessLocked(false)
	}

	async function handleScanNfc() {
		setFeedback(null)

		if (!supportsWebNfc) {
			setNfcHint("Seu navegador nao suporta leitura NFC nesta pagina.")
			setFeedback({
				kind: "error",
				message: "Seu navegador nao suporta leitura NFC nesta pagina.",
			})
			return
		}

		const NdefReader = (window as WindowWithNdef).NDEFReader

		if (!NdefReader) {
			setFeedback({
				kind: "error",
				message: "Seu navegador nao suporta leitura NFC nesta pagina.",
			})
			return
		}

		setIsScanning(true)
		setNfcHint("Leitor ativo. Aproxime o cartao NFC do celular.")

		try {
			const reader = new NdefReader()

			reader.addEventListener(
				"reading",
				(event) => {
					const readingEvent = event as NdefReadingEvent
					const detectedUuid = getUuidFromNdefMessage(readingEvent.message)

					setIsScanning(false)

					if (!detectedUuid) {
						setNfcHint("Nao foi possivel identificar o produto pelo cartao NFC.")
						setFeedback({
							kind: "error",
							message: "Nao foi possivel identificar o produto.",
						})
						return
					}

					setForm((current) => ({
						...current,
						uuid: detectedUuid,
					}))
					setSource("nfc")
					setNfcHint("Produto identificado pelo cartao NFC.")
					setFeedback(null)
				},
				{ once: true },
			)

			reader.addEventListener(
				"readingerror",
				() => {
					setIsScanning(false)
					setNfcHint("Nao foi possivel ler o cartao NFC. Tente novamente.")
					setFeedback({
						kind: "error",
						message: "Nao foi possivel identificar o produto.",
					})
				},
				{ once: true },
			)

			await reader.scan()
		} catch {
			setIsScanning(false)
			setNfcHint("Nao foi possivel iniciar a leitura NFC neste dispositivo.")
			setFeedback({
				kind: "error",
				message: "Nao foi possivel identificar o produto.",
			})
		}
	}

	function handleContinue(event: FormEvent<HTMLFormElement>) {
		event.preventDefault()
		setFeedback(null)

		if (!form.uuid.trim()) {
			setFeedback({
				kind: "error",
				message: "Nao foi possivel identificar o produto.",
			})
			return
		}

		if (!form.code.trim()) {
			setFeedback({
				kind: "error",
				message: "Digite o codigo abaixo do QR Code.",
			})
			return
		}

		setIsConfirmOpen(true)
	}

async function handleConfirmValidation() {
		setIsSubmitting(true)
		setFeedback(null)

		try {
			const response = await fetch("/api/code/verify", {
				method: "POST",
				headers: {
					"content-type": "application/json",
				},
				body: JSON.stringify({
					uuid: form.uuid.trim(),
					code: form.code.trim(),
				}),
			})

			const body = (await response.json()) as VerifyCodeResponse

			if (!response.ok) {
				const errorMessage =
					body.code === "CODE_ALREADY_USED"
						? "Este produto ja foi consumido."
						: body.error ?? "Nao foi possivel validar o codigo."

				setIsConfirmOpen(false)
				setFeedback({
					kind: "error",
					message: errorMessage,
				})
				return
			}

			setFeedback({
				kind: "success",
				message: body.message ?? "Produto validado com sucesso.",
			})
			setForm((current) => ({
				...current,
				code: "",
			}))
			setIsConfirmOpen(false)
			setIsSuccessLocked(true)
		} catch {
			setIsConfirmOpen(false)
			setFeedback({
				kind: "error",
				message: "Nao foi possivel concluir a solicitacao.",
			})
		} finally {
			setIsSubmitting(false)
		}
	}

	const identifyStatusLabel = form.uuid.trim()
		? "Produto identificado"
		: source === "nfc"
			? "Aguardando leitura do cartao NFC"
			: "Identificacao pendente"

	const sourceLabel = form.uuid.trim()
		? source === "nfc"
			? "Origem: NFC"
			: source === "manual"
				? "Origem: preenchimento manual"
				: "Origem: link ou QR Code"
		: "Use NFC ou preencha manualmente."

	return (
		<main className="page-shell">
			<section className="experience-card">
				<div className="hero-panel">
					<div className="hero-copy">
						<p className="eyebrow">Royal Pharma</p>
						<h1>Validacao inteligente do produto</h1>
						<p className="hero-text">
							Acesse a validacao do produto, identifique o cartao NFC e
							complete a confirmacao com o codigo unico abaixo do QR Code.
						</p>
					</div>

					<div className="signal-panel">
						<p className="signal-label">{identifyStatusLabel}</p>
						<p className="signal-value">
							{form.uuid.trim() || "Aproxime o cartao ou informe o identificador"}
						</p>
						<p className="signal-caption">{sourceLabel}</p>
					</div>
				</div>

				<ol className="step-strip" aria-label="Etapas da validacao">
					{[
						{ key: "identify", label: "1. Identificar" },
						{ key: "code", label: "2. Inserir codigo" },
						{ key: "confirm", label: "3. Confirmar" },
						{ key: "success", label: "4. Produto validado" },
					].map((step) => {
						const isActive = currentStep === step.key
						const isComplete =
							(step.key === "identify" && Boolean(form.uuid.trim())) ||
							(step.key === "code" &&
								(Boolean(form.uuid.trim()) || isConfirmOpen || isSuccessLocked)) ||
							(step.key === "confirm" && (isConfirmOpen || isSuccessLocked)) ||
							(step.key === "success" && isSuccessLocked)

						return (
							<li
								key={step.key}
								className={`step-chip${isActive ? " step-chip-active" : ""}${isComplete ? " step-chip-complete" : ""}`}
							>
								{step.label}
							</li>
						)
					})}
				</ol>

				<div className="content-grid">
					<section className="flow-card flow-card-accent">
						<div className="card-heading">
							<p className="section-kicker">Etapa 1</p>
							<h2>Aproxime o cartao NFC</h2>
							<p>
								No iPhone, o cartao pode abrir esta pagina com o identificador.
								No Android, voce tambem pode ler o cartao aqui.
							</p>
						</div>

						<div className="nfc-actions">
							<button
								type="button"
								className="primary-button"
								onClick={handleScanNfc}
								disabled={isScanning || isSuccessLocked}
							>
								{isScanning ? "Lendo cartao NFC..." : "Ler cartao NFC"}
							</button>
							<p className="support-copy">
								{supportsWebNfc
									? nfcHint
									: "Leitura NFC no navegador disponivel apenas em dispositivos compativeis e com HTTPS."}
							</p>
						</div>

						<div className="manual-entry">
							<p className="manual-label">Fallback manual</p>
							<label className="field">
								<span>Identificador do produto</span>
								<input
									name="uuid"
									value={form.uuid}
									onChange={(event) => handleUuidChange(event.currentTarget.value)}
									placeholder="00000000-0000-0000-0000-000000000000"
									autoComplete="off"
									disabled={isSuccessLocked}
								/>
							</label>
						</div>
					</section>

					<section className="flow-card">
						<div className="card-heading">
							<p className="section-kicker">Etapa 2</p>
							<h2>Digite o codigo abaixo do QR Code</h2>
							<p>
								Depois de identificar o produto, informe o codigo unico de
								validacao para seguir para a confirmacao final.
							</p>
						</div>

						<form className="verify-form" onSubmit={handleContinue}>
							<label className="field">
								<span>Codigo unico de validacao</span>
								<input
									name="code"
									value={form.code}
									onChange={(event) => updateField("code", event.currentTarget.value)}
									placeholder="Digite o codigo impresso"
									autoComplete="off"
									disabled={!form.uuid.trim() || isSuccessLocked}
								/>
							</label>

							<button
								type="submit"
								className="secondary-button"
								disabled={isConfirmDisabled}
							>
								Confirmar validacao
							</button>
						</form>

						<p className="support-copy">
							{form.uuid.trim()
								? "Produto identificado. Revise o codigo e avance para a confirmacao."
								: "Primeiro identifique o produto para liberar a validacao."}
						</p>
					</section>
				</div>

				{feedback ? (
					<p className={`feedback feedback-${feedback.kind}`}>{feedback.message}</p>
				) : null}

				{isSuccessLocked ? (
					<section className="success-card">
						<p className="section-kicker">Concluido</p>
						<h2>Produto validado com sucesso</h2>
						<p>
							O codigo foi consumido com seguranca. Use esta mesma identificacao
							apenas se precisar validar outro item.
						</p>
						<button
							type="button"
							className="primary-button"
							onClick={resetForAnotherValidation}
						>
							Validar outro produto
						</button>
					</section>
				) : null}
			</section>

			{isConfirmOpen ? (
				<div className="modal-backdrop" role="presentation">
					<section
						className="confirm-modal"
						role="dialog"
						aria-modal="true"
						aria-labelledby="confirm-title"
					>
						<p className="section-kicker">Etapa 3</p>
						<h2 id="confirm-title">Queimar codigo unico de validacao</h2>
						<p className="confirm-copy">
							Ao confirmar, este codigo sera validado e nao podera ser usado
							novamente.
						</p>

						<div className="confirm-summary">
							<div>
								<span>Identificador</span>
								<strong>{form.uuid.trim()}</strong>
							</div>
							<div>
								<span>Codigo informado</span>
								<strong>{form.code.trim()}</strong>
							</div>
						</div>

						<div className="modal-actions">
							<button
								type="button"
								className="ghost-button"
								onClick={() => setIsConfirmOpen(false)}
								disabled={isSubmitting}
							>
								Revisar
							</button>
							<button
								type="button"
								className="primary-button"
								onClick={handleConfirmValidation}
								disabled={isSubmitting}
							>
								{isSubmitting ? "Validando..." : "Queimar e validar"}
							</button>
						</div>
					</section>
				</div>
			) : null}
		</main>
	)
}

const rootElement = document.getElementById("root")

if (!rootElement) {
	throw new Error("Root element not found")
}

createRoot(rootElement).render(<App />)
