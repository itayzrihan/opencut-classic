const FONT_LOAD_SAMPLE_TEXTS = [
	"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789",
	"אבגדהוזחטיכלמנסעפצקרשת",
];

export async function loadDocumentFontSamples({
	font,
}: {
	font: string;
}): Promise<void> {
	await Promise.all(
		FONT_LOAD_SAMPLE_TEXTS.map((sampleText) =>
			document.fonts.load(font, sampleText),
		),
	);
}
