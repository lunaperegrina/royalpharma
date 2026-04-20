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

const validationSteps: ReadonlyArray<{ key: ValidationStep; label: string }> = [
	{ key: "identify", label: "1. Identificar" },
	{ key: "code", label: "2. Inserir codigo" },
	{ key: "confirm", label: "3. Confirmar" },
	{ key: "success", label: "4. Produto validado" },
]

const uuidPattern =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const kickerClass =
	"text-[0.74rem] font-black uppercase tracking-[0.22em] text-[#0f7a5a]"

const bodyTextClass = "text-base leading-7 text-[#5b6d66]"

const cardClass =
	"relative rounded-[28px] border border-[rgba(28,53,45,0.12)] bg-[rgba(255,251,245,0.86)] p-5 shadow-[0_18px_50px_rgba(71,60,34,0.08)] sm:p-6 sm:rounded-[32px]"

const cardHeadingClass = "grid gap-2.5"

const labelClass = "grid gap-2"

const labelTextClass = "text-[0.9rem] font-bold text-[#173228]"

const inputClass =
	"w-full rounded-[18px] border border-[rgba(28,53,45,0.12)] bg-[rgba(255,255,255,0.8)] px-[18px] py-4 text-[#173228] transition duration-150 placeholder:text-[#7b8b84] focus:-translate-y-px focus:border-[rgba(15,122,90,0.42)] focus:bg-white focus:outline-none focus:ring-4 focus:ring-[rgba(15,122,90,0.12)] disabled:cursor-not-allowed disabled:opacity-70"

const buttonBaseClass =
	"min-h-[54px] rounded-full px-[18px] py-[14px] text-sm font-extrabold transition duration-150 disabled:cursor-wait disabled:opacity-70 enabled:hover:-translate-y-px"

const primaryButtonClass = `${buttonBaseClass} bg-linear-[135deg,#0f7a5a,#09553e] text-white shadow-[0_14px_26px_rgba(15,122,90,0.22)]`

const secondaryButtonClass = `${buttonBaseClass} bg-linear-[135deg,#cab06d,#a88a42] text-[#fffdf8] shadow-[0_14px_24px_rgba(168,138,66,0.2)]`

const ghostButtonClass = `${buttonBaseClass} border border-[rgba(28,53,45,0.24)] bg-[rgba(255,255,255,0.5)] text-[#173228] shadow-none`

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

	const feedbackClass =
		feedback?.kind === "success"
			? "mt-5 rounded-[18px] bg-[rgba(19,125,83,0.14)] px-4 py-[14px] font-bold text-[#126b49]"
			: "mt-5 rounded-[18px] bg-[rgba(182,57,35,0.12)] px-4 py-[14px] font-bold text-[#a63d24]"

	return (
		<main className="relative min-h-screen overflow-hidden bg-[radial-gradient(circle_at_top_left,rgba(208,156,66,0.2),transparent_30%),radial-gradient(circle_at_bottom_right,rgba(15,122,90,0.18),transparent_34%),linear-gradient(180deg,#f4eddf_0%,#efe7d8_100%)] font-[Avenir_Next,Trebuchet_MS,Segoe_UI,sans-serif] text-[#173228]">
			<div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.18),rgba(255,255,255,0.18)),repeating-linear-gradient(135deg,rgba(23,50,40,0.015)_0,rgba(23,50,40,0.015)_2px,transparent_2px,transparent_12px)]" />

			<div className="relative grid min-h-screen place-items-center p-4 sm:p-6">
				<section className="relative w-full max-w-[1080px] overflow-hidden rounded-[28px] border border-[rgba(28,53,45,0.12)] bg-[rgba(255,252,247,0.86)] p-5 shadow-[0_28px_80px_rgba(48,43,26,0.12),inset_0_1px_0_rgba(255,255,255,0.55)] backdrop-blur-[18px] sm:rounded-[34px] sm:p-8 lg:p-10">
					<div className="pointer-events-none absolute inset-3 rounded-[20px] border border-[rgba(191,161,96,0.16)] sm:inset-[18px] sm:rounded-[26px]" />

					<div className="relative grid gap-5 pb-7 lg:grid-cols-[minmax(0,1.5fr)_minmax(300px,0.8fr)] lg:items-start">
						<div className="max-w-[680px]">
							<p className={kickerClass}>Royal Pharma</p>
							<h1 className="max-w-[10ch] font-serif text-[clamp(2.5rem,5vw,4.5rem)] leading-[0.95] font-bold tracking-[-0.03em] max-[480px]:max-w-none">
								Validacao inteligente do produto
							</h1>
							<p className={`mt-4 ${bodyTextClass}`}>
								Acesse a validacao do produto, identifique o cartao NFC e
								complete a confirmacao com o codigo unico abaixo do QR Code.
							</p>
						</div>

						<div className="rounded-[24px] border border-[rgba(15,122,90,0.16)] bg-[linear-gradient(135deg,rgba(255,255,255,0.8),rgba(240,248,243,0.72))] p-[20px] shadow-[inset_0_1px_0_rgba(255,255,255,0.55)]">
							<p className={kickerClass}>{identifyStatusLabel}</p>
							<p className="mt-2 text-base font-bold break-words">
								{form.uuid.trim() || "Aproxime o cartao ou informe o identificador"}
							</p>
							<p className="mt-2 text-[0.92rem] leading-6 text-[#5b6d66]">
								{sourceLabel}
							</p>
						</div>
					</div>

					<ol
						className="relative mb-7 grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4"
						aria-label="Etapas da validacao"
					>
						{validationSteps.map((step) => {
							const isActive = currentStep === step.key
							const isComplete =
								(step.key === "identify" && Boolean(form.uuid.trim())) ||
								(step.key === "code" &&
									(Boolean(form.uuid.trim()) || isConfirmOpen || isSuccessLocked)) ||
								(step.key === "confirm" && (isConfirmOpen || isSuccessLocked)) ||
								(step.key === "success" && isSuccessLocked)

							const stepClass = [
								"rounded-full border px-[14px] py-3 text-center text-[0.88rem] font-bold transition duration-150",
								"border-[rgba(28,53,45,0.12)] bg-[rgba(255,255,255,0.5)] text-[#5b6d66]",
								isActive
									? "-translate-y-px border-[rgba(15,122,90,0.35)] bg-[rgba(15,122,90,0.12)] text-[#09553e]"
									: "",
								isComplete
									? "border-[rgba(15,122,90,0.28)] text-[#09553e]"
									: "",
							]
								.filter(Boolean)
								.join(" ")

							return (
								<li key={step.key} className={stepClass}>
									{step.label}
								</li>
							)
						})}
					</ol>

					<div className="relative grid gap-5 lg:grid-cols-2">
						<section
							className={`${cardClass} bg-[radial-gradient(circle_at_top_right,rgba(15,122,90,0.12),transparent_36%),rgba(255,251,245,0.92)]`}
						>
							<div className={`${cardHeadingClass} mb-[22px]`}>
								<p className={kickerClass}>Etapa 1</p>
								<h2 className="font-serif text-[clamp(1.5rem,3vw,2.1rem)] leading-none font-bold tracking-[-0.03em]">
									Aproxime o cartao NFC
								</h2>
								<p className={bodyTextClass}>
									No iPhone, o cartao pode abrir esta pagina com o identificador.
									No Android, voce tambem pode ler o cartao aqui.
								</p>
							</div>

							<div className="grid gap-3.5">
								<button
									type="button"
									className={primaryButtonClass}
									onClick={handleScanNfc}
									disabled={isScanning || isSuccessLocked}
								>
									{isScanning ? "Lendo cartao NFC..." : "Ler cartao NFC"}
								</button>
								<p className={bodyTextClass}>
									{supportsWebNfc
										? nfcHint
										: "Leitura NFC no navegador disponivel apenas em dispositivos compativeis e com HTTPS."}
								</p>
							</div>

							<div className="mt-5 grid gap-3.5 border-t border-[rgba(28,53,45,0.08)] pt-5">
								<p className={kickerClass}>Fallback manual</p>
								<label className={labelClass}>
									<span className={labelTextClass}>Identificador do produto</span>
									<input
										name="uuid"
										value={form.uuid}
										onChange={(event) => handleUuidChange(event.currentTarget.value)}
										placeholder="00000000-0000-0000-0000-000000000000"
										autoComplete="off"
										disabled={isSuccessLocked}
										className={inputClass}
									/>
								</label>
							</div>
						</section>

						<section className={cardClass}>
							<div className={`${cardHeadingClass} mb-[22px]`}>
								<p className={kickerClass}>Etapa 2</p>
								<h2 className="font-serif text-[clamp(1.5rem,3vw,2.1rem)] leading-none font-bold tracking-[-0.03em]">
									Digite o codigo abaixo do QR Code
								</h2>
								<p className={bodyTextClass}>
									Depois de identificar o produto, informe o codigo unico de
									validacao para seguir para a confirmacao final.
								</p>
							</div>

							<form className="grid gap-3.5" onSubmit={handleContinue}>
								<label className={labelClass}>
									<span className={labelTextClass}>Codigo unico de validacao</span>
									<input
										name="code"
										value={form.code}
										onChange={(event) => updateField("code", event.currentTarget.value)}
										placeholder="Digite o codigo impresso"
										autoComplete="off"
										disabled={!form.uuid.trim() || isSuccessLocked}
										className={inputClass}
									/>
								</label>

								<button
									type="submit"
									className={secondaryButtonClass}
									disabled={isConfirmDisabled}
								>
									Confirmar validacao
								</button>
							</form>

							<p className={`mt-3.5 ${bodyTextClass}`}>
								{form.uuid.trim()
									? "Produto identificado. Revise o codigo e avance para a confirmacao."
									: "Primeiro identifique o produto para liberar a validacao."}
							</p>
						</section>
					</div>

					{feedback ? (
						<p className={feedbackClass}>{feedback.message}</p>
					) : null}

					{isSuccessLocked ? (
						<section className={`${cardClass} mt-5 grid gap-3 border-[rgba(15,122,90,0.24)] bg-[radial-gradient(circle_at_top_right,rgba(15,122,90,0.12),transparent_28%),rgba(245,252,248,0.94)]`}>
							<p className={kickerClass}>Concluido</p>
							<h2 className="font-serif text-[clamp(1.5rem,3vw,2.1rem)] leading-none font-bold tracking-[-0.03em]">
								Produto validado com sucesso
							</h2>
							<p className={bodyTextClass}>
								O codigo foi consumido com seguranca. Use esta mesma identificacao
								apenas se precisar validar outro item.
							</p>
							<button
								type="button"
								className={primaryButtonClass}
								onClick={resetForAnotherValidation}
							>
								Validar outro produto
							</button>
						</section>
					) : null}
				</section>
			</div>

			{isConfirmOpen ? (
				<div
					className="fixed inset-0 z-10 grid place-items-center bg-[rgba(17,28,24,0.48)] p-5 backdrop-blur-[8px]"
					role="presentation"
				>
					<section
						className={`${cardClass} w-full max-w-[520px] bg-[rgba(255,249,241,0.98)]`}
						role="dialog"
						aria-modal="true"
						aria-labelledby="confirm-title"
					>
						<p className={kickerClass}>Etapa 3</p>
						<h2
							id="confirm-title"
							className="mt-1 font-serif text-[clamp(1.5rem,3vw,2.1rem)] leading-none font-bold tracking-[-0.03em]"
						>
							Queimar codigo unico de validacao
						</h2>
						<p className={`mt-4 ${bodyTextClass}`}>
							Ao confirmar, este codigo sera validado e nao podera ser usado
							novamente.
						</p>

						<div className="my-[22px] grid gap-[14px] rounded-[20px] border border-[rgba(28,53,45,0.08)] bg-[rgba(255,255,255,0.82)] p-[18px]">
							<div>
								<span className="mb-1.5 block text-[0.82rem] font-bold uppercase tracking-[0.08em] text-[#5b6d66]">
									Identificador
								</span>
								<strong className="text-base break-words">{form.uuid.trim()}</strong>
							</div>
							<div>
								<span className="mb-1.5 block text-[0.82rem] font-bold uppercase tracking-[0.08em] text-[#5b6d66]">
									Codigo informado
								</span>
								<strong className="text-base break-words">{form.code.trim()}</strong>
							</div>
						</div>

						<div className="grid gap-3 md:grid-cols-2">
							<button
								type="button"
								className={ghostButtonClass}
								onClick={() => setIsConfirmOpen(false)}
								disabled={isSubmitting}
							>
								Revisar
							</button>
							<button
								type="button"
								className={primaryButtonClass}
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
