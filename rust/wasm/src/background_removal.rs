use background_removal::{
    BackgroundRemovalSettings, DuplicatePlacementInput, plan_duplicate_placement,
    refine_alpha_mask, resolve_settings,
};
use wasm_bindgen::{JsValue, prelude::wasm_bindgen};

#[wasm_bindgen(js_name = defaultBackgroundRemovalSettings)]
pub fn default_background_removal_settings() -> Result<JsValue, JsValue> {
    serde_wasm_bindgen::to_value(&BackgroundRemovalSettings::default())
        .map_err(|error| JsValue::from_str(&error.to_string()))
}

#[wasm_bindgen(js_name = resolveBackgroundRemovalSettings)]
pub fn resolve_background_removal_settings(value: JsValue) -> Result<JsValue, JsValue> {
    let settings: BackgroundRemovalSettings = serde_wasm_bindgen::from_value(value)
        .map_err(|error| JsValue::from_str(&error.to_string()))?;
    serde_wasm_bindgen::to_value(&resolve_settings(settings))
        .map_err(|error| JsValue::from_str(&error.to_string()))
}

#[wasm_bindgen(js_name = planBackgroundRemovalDuplicate)]
pub fn plan_background_removal_duplicate(value: JsValue) -> Result<JsValue, JsValue> {
    let input: DuplicatePlacementInput = serde_wasm_bindgen::from_value(value)
        .map_err(|error| JsValue::from_str(&error.to_string()))?;
    let placement = plan_duplicate_placement(&input)
        .map_err(|error| JsValue::from_str(&format!("{error:?}")))?;
    serde_wasm_bindgen::to_value(&placement).map_err(|error| JsValue::from_str(&error.to_string()))
}

#[wasm_bindgen(js_name = refineBackgroundAlpha)]
pub fn refine_background_alpha(
    current: &[u8],
    previous: &[u8],
    mask_threshold: f32,
    edge_contrast: f32,
    temporal_smoothing: f32,
) -> Vec<u8> {
    refine_alpha_mask(
        current,
        previous,
        mask_threshold,
        edge_contrast,
        temporal_smoothing,
    )
}
