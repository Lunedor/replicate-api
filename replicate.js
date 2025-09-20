// replicate.js

let canvasStates = {}; // Track state per canvas (only for the mask)
let currentModelVersion = null;

const modelList = {
     "text2image": [
        "black-forest-labs/flux-1.1-pro-ultra",
        "black-forest-labs/flux-1.1-pro",
        "black-forest-labs/flux-dev",
        "black-forest-labs/flux-schnell",
        "black-forest-labs/flux-dev-lora",
        "bytedance/flux-pulid",
        "stability-ai/stable-diffusion-3.5-large",
        "stability-ai/stable-diffusion-3.5-large-turbo",
        "stability-ai/stable-diffusion-3.5-medium",
        "stability-ai/stable-diffusion-3",
        "stability-ai/sdxl",
        "ideogram-ai/ideogram-v2a",
        "ideogram-ai/ideogram-v2a-turbo",
        "google/imagen-3",
        "google/imagen-3-fast",
        "recraft-ai/recraft-v3-svg",
        "luma/photon",
        "luma/photon-flash",
        "minimax/image-01",
        "nvidia/sana",
        "lucataco/dreamshaper-xl-turbo"
    ],
    "inpaint": [
        "black-forest-labs/flux-fill-pro",
        "ideogram-ai/ideogram-v2",
        "ideogram-ai/ideogram-v2-turbo",
        "stability-ai/stable-diffusion-inpainting",
        "zsxkib/flux-dev-inpainting",
        "lucataco/realistic-vision-v5-inpainting",
        "asiryan/realistic-vision-v6.0-b1",
        "pagebrain/dreamshaper-v7",
        "fermatresearch/flux-controlnet-inpaint"
    ],
    "outpaint": [
        "black-forest-labs/flux-fill-pro",
        "fermatresearch/sdxl-outpainting-lora", 
		"wan-video/wan-2.2-i2v-fast"
    ]
};

let modelCache = {};
let allModelsCache = null;
let selectedModel = null;
let isUserSelection = false;

// Utility functions (unchanged)
function getApiKey() {
    return document.getElementById('api-key').value.trim();
}

function validateApiKey(apiKey) {
    return apiKey !== "";
}

// Save API Key
function saveApiKey(key) {
    if (key.startsWith('r8_')) { // Basic Replicate key validation
        localStorage.setItem('replicateApiKey', key);
        return true;
    }
    return false;
}

// Load API Key
function loadApiKey() {
    return localStorage.getItem('replicateApiKey') || '';
}

// Clear API Key
function clearApiKey() {
    localStorage.removeItem('replicateApiKey');
}

let customModels = JSON.parse(localStorage.getItem('customModels') || '{}');

function getSelectedModel() {
    const modelSelect = document.getElementById("model-select");
    if (modelSelect && modelSelect.options && modelSelect.selectedIndex >= 0) {
        return modelSelect.options[modelSelect.selectedIndex].value;
    }
    return null;
}

function parseModelUrl(url) {
    const match = url.match(/replicate\.com\/([^\/]+\/[^\/]+)/);
    return match ? match[1] : null;
}

// Event Listener for Add Model
document.getElementById('add-model').addEventListener('click', async () => {
    const url = document.getElementById('custom-model-url').value;
    const modelIdentifier = parseModelUrl(url);
    
    if (!modelIdentifier) {
        alert('Invalid URL format. Use: https://replicate.com/owner/model-name');
        return;
    }
    
    try {
        const versionDetails = await fetchModelVersionDetails(modelIdentifier);
        customModels[modelIdentifier] = {
            versions: [versionDetails.id],
            addedAt: new Date().toISOString()
        };
        localStorage.setItem('customModels', JSON.stringify(customModels));

        // Force UI update
        allModelsCache = null;
        selectedModel = modelIdentifier;
        await populateModelSelect('');
        
        // Manually trigger model change
        const event = new Event('change');
        document.getElementById("model-select").dispatchEvent(event);

    } catch (error) {
        alert(`Failed to add model: ${error.message}`);
    }
});

function dataURLtoBlob(dataURL) {
    const parts = dataURL.split(';base64,');
    const contentType = parts[0].split(':')[1];
    const raw = window.atob(parts[1]);
    const rawLength = raw.length;
    const uInt8Array = new Uint8Array(rawLength);

    for (let i = 0; i < rawLength; ++i) {
        uInt8Array[i] = raw.charCodeAt(i);
    }

    return new Blob([uInt8Array], {
        type: contentType
    });
}

// --- Canvas Drawing Functions (Simplified) ---
function clearMask() { // No 'name' parameter needed now
    const state = canvasStates["mask"]; // Always use "mask"
    if (state && state.ctx) {
        state.ctx.clearRect(0, 0, state.ctx.canvas.width, state.ctx.canvas.height);
        state.undoStack = [];
    }
}

function undo() { // No 'name' parameter
    const state = canvasStates["mask"];
    if (state && state.undoStack.length > 0) {
        state.ctx.putImageData(state.undoStack.pop(), 0, 0);
    }
}

function startDrawing(event) {
    const state = canvasStates["mask"];
    if (!state) return;

    const rect = event.target.getBoundingClientRect();
    state.lastX = (event.clientX - rect.left) * state.scaleX;
    state.lastY = (event.clientY - rect.top) * state.scaleY;
    state.isDrawing = true;

    // Start new path
    state.ctx.beginPath();
    state.ctx.moveTo(state.lastX, state.lastY);
}

function draw(event) {
    const state = canvasStates["mask"];
    if (!state || !state.isDrawing) return;

    const rect = event.target.getBoundingClientRect();
    const x = (event.clientX - rect.left) * state.scaleX;
    const y = (event.clientY - rect.top) * state.scaleY;

    state.ctx.lineTo(x, y);
    state.ctx.stroke();

    // Update last coordinates
    state.lastX = x;
    state.lastY = y;
}

function stopDrawing() {
    const state = canvasStates["mask"];
    if (!state) return;

    state.isDrawing = false;
    if (state.ctx) {
        state.undoStack.push(state.ctx.getImageData(0, 0, state.ctx.canvas.width, state.ctx.canvas.height));
    }
}

function setupCanvas() {
    const canvas = document.getElementById('canvas-mask');
    const imgPreview = document.getElementById('preview-mask');

    if (!canvas || !imgPreview) return;

    // Set canvas dimensions to match image's natural size
    canvas.width = imgPreview.naturalWidth;
    canvas.height = imgPreview.naturalHeight;

    // Match displayed size to preview container
    canvas.style.width = imgPreview.clientWidth + 'px';
    canvas.style.height = imgPreview.clientHeight + 'px';

    // Calculate scaling factors
    const scaleX = imgPreview.naturalWidth / imgPreview.clientWidth;
    const scaleY = imgPreview.naturalHeight / imgPreview.clientHeight;

    // Initialize canvas state
    canvasStates["mask"] = {
        ctx: canvas.getContext('2d'),
        isDrawing: false,
        undoStack: [],
        scaleX,
        scaleY,
        lastX: 0,
        lastY: 0,
        brushSize: 20
    };

    const maskInput = document.getElementById('input-mask');
    if (maskInput) {
        maskInput.addEventListener('change', (e) => {
            // Clear canvas when new mask is uploaded
            const state = canvasStates["mask"];
            state.ctx.clearRect(0, 0, canvas.width, canvas.height);
        });
    }

    const state = canvasStates["mask"];
    state.ctx.lineCap = 'round';
    state.ctx.strokeStyle = '#ffffff';
    state.ctx.lineWidth = state.brushSize;

    // Add proper event listeners
    canvas.removeEventListener('mousedown', startDrawing);
    canvas.removeEventListener('mousemove', draw);
    canvas.removeEventListener('mouseup', stopDrawing);

    canvas.addEventListener('mousedown', (e) => startDrawing(e));
    canvas.addEventListener('mousemove', (e) => draw(e));
    canvas.addEventListener('mouseup', () => stopDrawing());
}

async function fetchWithTimeout(url, options = {}, timeout = 30000) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    
    try {
        const response = await fetch(url, {
            ...options,
            signal: controller.signal
        });
        clearTimeout(timeoutId);
        return response;
    } catch (error) {
        clearTimeout(timeoutId);
        throw error;
    }
}

// Updated runPrediction function
async function runPrediction() {
    const apiKey = getApiKey();
    const statusElement = document.getElementById('status-message');
    const generateButton = document.getElementById('generate-button');
    
    // Clear previous output and reset status
    const outputImages = document.getElementById('output-images');
    if (outputImages) outputImages.innerHTML = '';
    statusElement.classList.remove('error');
    statusElement.innerText = "Starting prediction...";

    try {
        // Validate API key and model
        if (!validateApiKey(apiKey)) {
            throw new Error("Please enter your Replicate API key.");
        }
        if (!currentModelVersion) {
            throw new Error("Model version not found. Please select a model.");
        }

        // Fetch model details
        const versionDetails = await fetchModelVersionDetails(
            currentModelVersion.modelIdentifier,
            currentModelVersion.versionId
        );

        // Validate schema
        const inputSchema = versionDetails?.openapi_schema?.components?.schemas?.Input?.properties;
        const requiredFields = versionDetails?.openapi_schema?.components?.schemas?.Input?.required || [];
        if (!inputSchema) throw new Error("Could not retrieve input schema");

        // Process inputs
        const input = {};
        for (const [inputName, schema] of Object.entries(inputSchema)) {
            const element = document.getElementById(`input-${inputName}`);
            if (!element) continue;

            // Handle file inputs
            if (schema.format === "uri") {
                if (inputName === "mask") {
                    const canvas = document.getElementById('canvas-mask');
                    if (canvas) input[inputName] = canvas.toDataURL('image/png');
                } else if (element.files?.[0]) {
                    input[inputName] = await fileToDataURI(element.files[0]);
                }
                continue;
            }

            // Handle other input types
            switch(schema.type) {
                case "string":
                    input[inputName] = element.value.trim();
                    break;
                case "number":
                case "integer":
                    input[inputName] = Number(element.value) || 0;
                    break;
                case "boolean":
                    input[inputName] = element.checked;
                    break;
                case "array":
                    input[inputName] = element.value.split(',').map(i => i.trim());
                    break;
            }
        }

        // Validate required fields
        for (const field of requiredFields) {
            if (input[field] === undefined || input[field] === "") {
                throw new Error(`Missing required field: ${field}`);
            }
        }

        // Handle seed generation
        if (!input.seed || isNaN(input.seed)) {
            input.seed = Math.floor(Math.random() * 1000000000);
        }

        // Start prediction
        generateButton.disabled = true;
        const prediction = await createPrediction(apiKey, currentModelVersion.versionId, input);
        
        // Poll prediction status
        let predictionResult;
        let retries = 3;
        do {
            await new Promise(resolve => setTimeout(resolve, 2000));
            try {
                predictionResult = await getPrediction(apiKey, prediction.id);
            } catch (error) {
                if (retries-- <= 0) throw error;
                await new Promise(resolve => setTimeout(resolve, 5000));
            }
        } while (predictionResult?.status === "starting" || predictionResult?.status === "processing");

        // Handle final result
        if (predictionResult.status === "succeeded") {
            updateOutput(predictionResult.output);
            statusElement.innerText = "Prediction succeeded!";
        } else {
            throw new Error(predictionResult.error || "Prediction failed");
        }

    } catch (error) {
        statusElement.innerText = `Error: ${error.message}`;
        statusElement.classList.add('error');
        console.error("Prediction error:", error);
    } finally {
        generateButton.disabled = false;
    }
}

function createInputElement(name, schema) {
    const container = document.createElement("div");
    const label = document.createElement("label");
    label.textContent = `${name}:`;
    label.setAttribute("for", `input-${name}`);
	

    let input;
    const isImageField = ["image", "mask"].includes(name) && schema.format === "uri";

    if (isImageField) {
        return createImageUploadField(name, schema);
    }
	
	if (schema.type === "string" && schema.format === "uri") {
        return createFileUploadField(name, schema);
    }

    switch (schema.type) {
        case "string":
            if (schema.enum) {
                input = document.createElement("select");
                schema.enum.forEach(option => {
                    const optionElement = document.createElement("option");
                    optionElement.value = option;
                    optionElement.textContent = option;
                    input.appendChild(optionElement);
                });
            } else {
                input = document.createElement(schema.format === "url" ? "input" : "textarea");
                input.type = schema.format === "url" ? "url" : "text";
            }
            break;

        case "number":
        case "integer":
            input = document.createElement("input");
            input.type = "number";
            input.min = schema.minimum ?? "";
            input.max = schema.maximum ?? "";
            input.step = schema.multiple_of ?? "any";
            break;

        case "boolean":
            input = document.createElement("input");
            input.type = "checkbox";
            break;

        case "array":
            input = document.createElement("textarea");
            break;			

        default:
            return null;
    }

    input.id = `input-${name}`;
    input.placeholder = schema.description || name;

    if (schema.default !== undefined) {
        if (schema.type === "boolean") {
            input.checked = schema.default;
        } else {
            input.value = schema.type === "array" ?
                schema.default.join(",") :
                schema.default;
        }
    }

    container.appendChild(label);
    container.appendChild(input);

    // Add error message container
    const error = document.createElement("div");
    error.id = `error-${name}`;
    error.className = "error-message";
    container.appendChild(error);

    return container;
}

function createImageUploadField(name, schema) {
    const container = document.createElement("div");

    // Create label element
    const label = document.createElement("label");
    label.textContent = `${name}:`;
    label.setAttribute("for", `input-${name}`);

    // Error element
    const error = document.createElement("div");
    error.id = `error-${name}`;
    error.className = "error-message";

    // File input
    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = "image/*";
    fileInput.id = `input-${name}`;
    fileInput.addEventListener("change", (event) => {
        handleImageUpload(event, name);
    });

    // Preview container
    const previewContainer = document.createElement("div");
    previewContainer.className = "preview-container";
    previewContainer.id = `${name}-preview-container`; // Add ID for targeting
    previewContainer.style.display = 'none'; // Initially hidden

    // Image preview
    const imgPreview = document.createElement("img");
    imgPreview.className = "image-preview";
    imgPreview.id = `preview-${name}`;

    // Remove button
    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.textContent = "Remove";
    removeButton.id = `remove-${name}-button`;
    removeButton.style.display = 'none'; // Initially hidden
    removeButton.addEventListener('click', () => removeImage(name));


    // Add elements to container
    container.appendChild(label);
    container.appendChild(fileInput);
    container.appendChild(error);
    container.appendChild(previewContainer);
    previewContainer.appendChild(imgPreview);
    container.appendChild(removeButton); // Add remove button

    if (name === "mask") {
        // Canvas and controls
        const canvas = document.createElement("canvas");
        canvas.id = "canvas-mask";
        canvas.className = "mask-canvas";
        previewContainer.appendChild(canvas);

        const controls = document.createElement("div");
        controls.className = "brush-controls";
        controls.innerHTML = `
            <input type="range" id="brush-size-mask" min="1" max="100" value="20">
            <button type="button" id="clear-mask">Clear</button>
            <button type="button" id="undo-mask">Undo</button>
        `;
        container.appendChild(controls);
    }

    return container;
}

function getAcceptedFileTypes(schema) {
    // Handle Flux model's special case
    if (schema.description?.includes("Must be jpeg, png, gif, or webp")) {
        return "image/jpeg,image/png,image/gif,image/webp";
    }
    
    // Generic handling from schema
    return schema['x-accept'] || 
           schema['x-file-types']?.join(',') || 
           'image/*';
}

async function validateFile(file, schema) {
    // Validate file size
    if (schema['x-max-size']) {
        const maxBytes = schema['x-max-size'] * 1024 * 1024;
        if (file.size > maxBytes) {
            throw new Error(`File too large (max ${schema['x-max-size']}MB)`);
        }
    }

    // Validate file type
    const acceptedTypes = getAcceptedFileTypes(schema)
        .split(',')
        .map(t => t.trim().toLowerCase());

    // Get normalized file type
    const fileType = file.type.toLowerCase();
    
    // Check against accepted types
    const isValidType = acceptedTypes.some(type => {
        // Handle wildcards and specific types
        if (type === '*/*' || type === 'image/*') return true;
        if (type.includes('*')) {
            const [mainType] = type.split('/');
            return fileType.startsWith(mainType);
        }
        return fileType === type;
    });

    if (!isValidType) {
        throw new Error(`Invalid file type: ${file.type}. Allowed types: ${acceptedTypes.join(', ')}`);
    }

    // Validate image dimensions if specified
    if (schema['x-dimensions']) {
        await new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                if (img.naturalWidth !== schema['x-dimensions'].width || 
                    img.naturalHeight !== schema['x-dimensions'].height) {
                    reject(new Error(`Must be ${schema['x-dimensions'].width}x${schema['x-dimensions'].height} pixels`));
                } else {
                    resolve();
                }
            };
            img.onerror = () => reject(new Error("Invalid image file"));
            img.src = URL.createObjectURL(file);
        });
    }
}

function fileToDataURI(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

// Updated createFileUploadField function
function createFileUploadField(name, schema) {
    const container = document.createElement("div");
    container.className = "file-upload-group";
    
    const label = document.createElement("label");
    label.textContent = `${schema.title || name}:`;
    label.htmlFor = `input-${name}`;

    const input = document.createElement("input");
    input.type = "file";
    input.id = `input-${name}`;
    input.accept = getAcceptedFileTypes(schema);
    
    const preview = document.createElement("div");
    preview.className = "file-preview";
    
    const error = document.createElement("div");
    error.className = "error-message";

    input.addEventListener("change", async () => {
        error.textContent = "";
        try {
            if (input.files[0]) {
                await validateFile(input.files[0], schema);
                preview.style.backgroundImage = `url(${URL.createObjectURL(input.files[0])}`;
            }
        } catch (err) {
            error.textContent = err.message;
            input.value = "";
        }
    });

    container.append(label, input, preview, error);
    return container;
}

function handleImageUpload(event, inputName) {
    const file = event.target.files[0];
    const imgPreview = document.getElementById(`preview-${inputName}`);
    const previewContainer = document.getElementById(`${inputName}-preview-container`);
    const removeButton = document.getElementById(`remove-${inputName}-button`);
    const errorElement = document.getElementById(`error-${inputName}`) || document.createElement("div"); // Fallback

    try {
        if (!file) {
            throw new Error("No file selected");
        }

        if (!file.type.startsWith("image/")) {
            throw new Error("Invalid file type. Please upload an image");
        }

        errorElement.textContent = "";
        const reader = new FileReader();

        reader.onload = function(e) {
            imgPreview.onload = () => {
                if (inputName === "mask") {
                    setupCanvas();
                }
            };
            imgPreview.src = e.target.result;
            previewContainer.style.display = 'block'; // Show preview
            removeButton.style.display = 'block'; // Show remove button
        };

        reader.readAsDataURL(file);
    } catch (error) {
        errorElement.textContent = error.message;
        event.target.value = ""; // Clear invalid file selection
        previewContainer.style.display = 'none'; // Hide preview on error
        removeButton.style.display = 'none'; // Hide remove button on error
    }
}

function removeImage(inputName) {
    const fileInput = document.getElementById(`input-${inputName}`);
    const imgPreview = document.getElementById(`preview-${inputName}`);
    const previewContainer = document.getElementById(`${inputName}-preview-container`);
    const removeButton = document.getElementById(`remove-${inputName}-button`);

    fileInput.value = ""; // Clear file input
    imgPreview.src = ""; // Clear preview image
    previewContainer.style.display = 'none'; // Hide preview container
    removeButton.style.display = 'none'; // Hide remove button

    if (inputName === "mask") {
        clearMask(); // Clear canvas if it's a mask
    }
}

function renderDynamicInputs(schema) {
    const dynamicInputsContainer = document.getElementById('dynamic-inputs');
    dynamicInputsContainer.innerHTML = '';

    if (!schema?.properties) {
        dynamicInputsContainer.innerHTML = '<p>No input fields available</p>';
        return;
    }

    for (const inputName in schema.properties) {
        const inputSchema = schema.properties[inputName];
        const inputElement = createInputElement(inputName, inputSchema);
        if (inputElement) {
            dynamicInputsContainer.appendChild(inputElement);

            // Add event listeners *after* appending
            if (inputName === "mask") {
                const clearButton = document.getElementById('clear-mask');
                const undoButton = document.getElementById('undo-mask');
                const brushSizeInput = document.getElementById('brush-size-mask');

                if (clearButton) {
                    clearButton.addEventListener('click', clearMask);
                }
                if (undoButton) {
                    undoButton.addEventListener('click', undo);
                }
                // In renderDynamicInputs function, update the brush size listener:
                if (brushSizeInput) {
                    brushSizeInput.addEventListener('input', (e) => {
                        const state = canvasStates["mask"];
                        if (state) {
                            state.brushSize = parseInt(e.target.value);
                            state.ctx.lineWidth = state.brushSize;
                        }
                    });
                }
            }
        }
    }
}

function createTextInput(name, schema) {
    const container = document.createElement("div");

    const label = document.createElement("label");
    label.textContent = `${name}:`;
    label.setAttribute("for", `input-${name}`);

    const input = document.createElement("input");
    input.type = "text";
    input.id = `input-${name}`;
    input.placeholder = schema.description || name;
    input.value = schema.default || "";

    container.appendChild(label);
    container.appendChild(input);
    return container;
}


async function createPrediction(apiKey, versionId, input) { // Changed parameter name
    const response = await fetch("https://tesla.x10.mx/proxy.php?endpoint=predictions", {
        method: "POST",
        headers: {
            'X-API-Key': apiKey, // From localStorage
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            version: versionId, // Directly use the version ID string
            input: input
        })
    });
    if (!response.ok) {
        const errorData = await response.json();
        throw new Error("Failed to create prediction: " + JSON.stringify(errorData));
    }
    return await response.json();
}

async function getPrediction(apiKey, id, retries = 3) {
    for (let i = 0; i < retries; i++) {
        try {
            const response = await fetchWithTimeout(
                `https://tesla.x10.mx/proxy.php?endpoint=predictions/${id}`,
                {
                    headers: {
                        'X-API-Key': apiKey, // From localStorage
						'Content-Type': 'application/json'
                    }
                },
                10000 // 10-second timeout for status checks
            );

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error("Failed to get prediction: " + JSON.stringify(errorData));
            }
            return await response.json();
        } catch (error) {
            if (i === retries - 1) throw error;
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
    }
}

function initImageModal() {
    const modal = document.getElementById('image-modal');
    const modalImg = document.getElementById('modal-image');
    const downloadBtn = document.getElementById('download-btn');
    const closeBtn = document.querySelector('.modal-close');

    // Click handlers
    document.querySelectorAll('#output-images img').forEach(img => {
        img.addEventListener('click', () => {
            modal.classList.add('modal-visible');
            modalImg.src = img.src;
            downloadBtn.dataset.downloadUrl = img.src;
        });
    });

    closeBtn.addEventListener('click', () => {
        modal.classList.remove('modal-visible');
    });

    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.classList.remove('modal-visible');
        }
    });

    downloadBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const url = downloadBtn.dataset.downloadUrl;
        if (url) {
            const link = document.createElement('a');
            link.href = url;
            link.download = `generated-image-${Date.now()}.png`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        }
    });
}

function updateOutput(output) {
    const outputImages = document.getElementById('output-images');
    outputImages.innerHTML = '';
    
    try {
        // Handle different output formats
        let imageUrls = [];
        
        if (typeof output === 'string') {
            imageUrls = [output];
        } else if (Array.isArray(output)) {
            imageUrls = output;
        } else if (output?.image) {
            imageUrls = [output.image];
        } else if (output?.images) {
            imageUrls = output.images;
        }

        if (imageUrls.length > 0) {
            imageUrls.forEach(imageUrl => {
                const container = document.createElement('div');
                container.className = 'image-container';
                
                const img = document.createElement('img');
                img.className = 'output-image';
                img.alt = "Generated Image";
                
                // Loading states
                img.style.opacity = '0.5';
                img.style.transition = 'opacity 0.3s';

                img.onerror = () => {
                    container.innerHTML = `
                        <div class="image-error">
                            Failed to load image<br>
                            <a href="${imageUrl}" target="_blank">Direct link</a>
                        </div>
                    `;
                };

                img.onload = () => {
                    img.style.opacity = '1';
                    
                    // Add click handler after image loads
                    img.addEventListener('click', () => {
                        const modal = document.getElementById('image-modal');
                        const modalImg = document.getElementById('modal-image');
                        const downloadBtn = document.getElementById('download-btn');
                        
                        if (modal && modalImg && downloadBtn) {
                            modal.classList.add('modal-visible');
                            modalImg.src = img.src;
                            downloadBtn.dataset.downloadUrl = img.src;
                        }
                    });
                };

                img.src = imageUrl;
                container.appendChild(img);
                outputImages.appendChild(container);
            });
        } else {
            const errorMessage = document.createElement('div');
            errorMessage.className = 'output-error';
            errorMessage.innerHTML = `
                No images found in output. Possible issues:<br>
                1. Content policy violation<br>
                2. Model-specific output format<br>
                3. Corrupted image generation
            `; // Removed predictionResult reference
            outputImages.appendChild(errorMessage);
        }
    } catch (error) {
        const errorElement = document.createElement('div');
        errorElement.className = 'output-error';
        errorElement.textContent = `Output error: ${error.message}`;
        outputImages.appendChild(errorElement);
    }
}

async function populateModelSelect(searchTerm = '') {
    const modelSelect = document.getElementById("model-select");
    const modelDetails = document.getElementById("model-details-container");

    if (!allModelsCache) {
        allModelsCache = {
            ...modelList,
            custom: Object.keys(customModels)
        };
    }

    // Filter models
    const filtered = Object.entries(allModelsCache).reduce((acc, [category, models]) => {
        const filteredModels = models.filter(model => 
            model.toLowerCase().includes(searchTerm.toLowerCase())
        );
        if (filteredModels.length > 0) acc[category] = filteredModels;
        return acc;
    }, {});

    modelSelect.innerHTML = '';

    // Add placeholder
    if (!selectedModel) {
        const placeholder = document.createElement("option");
        placeholder.textContent = "Select a model to view details";
        placeholder.disabled = true;
        placeholder.selected = true;
        modelSelect.appendChild(placeholder);
    }

    // Add filtered options
    for (const [category, models] of Object.entries(filtered)) {
        const optgroup = document.createElement("optgroup");
        optgroup.label = category.toUpperCase();
        
        models.forEach(model => {
            const option = document.createElement("option");
            option.value = model;
            option.textContent = model;
            optgroup.appendChild(option);
        });
        
        modelSelect.appendChild(optgroup);
    }

    // Preserve selection
    if (selectedModel && modelSelect.querySelector(`option[value="${selectedModel}"]`)) {
        modelSelect.value = selectedModel;
        modelDetails.style.display = 'block';
        isUserSelection = false;
    } else {
        modelDetails.style.display = 'none';
        selectedModel = null;
    }
}

document.getElementById('model-search').addEventListener('input', (e) => {
    populateModelSelect(e.target.value);
});

async function fetchModelVersionDetails(modelIdentifier) {
    const apiKey = getApiKey();
    if (!apiKey) return null;

    try {
        // First get model info to find latest version
        const [owner, name] = modelIdentifier.split('/');
        const modelResponse = await fetch(
            `https://tesla.x10.mx/proxy.php?endpoint=models/${owner}/${name}`,
            {
                headers: {
                   'X-API-Key': apiKey, // From localStorage
				   'Content-Type': 'application/json'
                }
            }
        );
        
        if (!modelResponse.ok) throw new Error(await modelResponse.text());
        const modelData = await modelResponse.json();
        
        // Now get version details using latest version ID
        const versionId = modelData.latest_version.id;
        const versionResponse = await fetch(
            `https://tesla.x10.mx/proxy.php?endpoint=models/${owner}/${name}/versions/${versionId}`,
            {
                headers: {
                   'X-API-Key': apiKey, // From localStorage
				   'Content-Type': 'application/json'
                }
            }
        );

        if (!versionResponse.ok) throw new Error(await versionResponse.text());
        return await versionResponse.json();

    } catch (error) {
        console.error("Model fetch error:", error);
        throw new Error(`Failed to load model: ${error.message}`);
    }
}

async function fetchDefaultVersion(modelIdentifier) {
    if (modelCache[modelIdentifier]?.versionId) {
        return modelCache[modelIdentifier];
    }

    try {
        const [owner, name] = modelIdentifier.split("/");
        const response = await fetch(
            `https://tesla.x10.mx/proxy.php?endpoint=models/${owner}/${name}`, {
                headers: {
                    'X-API-Key': getApiKey(), // From localStorage
				    'Content-Type': 'application/json'
                }
            });

        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();

        modelCache[modelIdentifier] = {
            versionId: data.latest_version.id,
            owner,
            name
        };

        return modelCache[modelIdentifier];

    } catch (error) {
        console.error("Fetch failed:", error);
        return null;
    }
}

// Fix the handleModelChange function
async function handleModelChange(e) {
    isUserSelection = true;
    selectedModel = e.target.value;
    
    if (!selectedModel) return;

    try {
        const versionData = await fetchDefaultVersion(selectedModel);
        currentModelVersion = {
            modelIdentifier: selectedModel,
            versionId: versionData.versionId,
            owner: versionData.owner,
            name: versionData.name
        };

        // Pass version ID to fetchModelVersionDetails
        const versionDetails = await fetchModelVersionDetails(
            currentModelVersion.modelIdentifier,
            currentModelVersion.versionId // Add this parameter
        );

        if (versionDetails?.openapi_schema?.components?.schemas?.Input) {
            renderDynamicInputs(versionDetails.openapi_schema.components.schemas.Input);
        }

        document.getElementById("model-details-container").innerHTML = `
            <a href="https://replicate.com/${currentModelVersion.owner}/${currentModelVersion.name}" 
               target="_blank"
               class="model-link">
               View model details
            </a>
        `;
    } catch (error) {
        console.error("Model change error:", error);
        document.getElementById("model-details-container").innerHTML = `
            <div class="error">Failed to load model details: ${error.message}</div>
        `;
    }
}

document.addEventListener('DOMContentLoaded', function() {
    const apiKeyInput = document.getElementById('api-key');
    const rememberCheckbox = document.getElementById('remember-key');
    const clearButton = document.getElementById('clear-key');
    const modelSelect = document.getElementById("model-select");
    const generateButton = document.getElementById('generate-button');
	const modal = document.getElementById('image-modal');
    const closeBtn = document.querySelector('.modal-close');
    const downloadBtn = document.getElementById('download-btn');

    // Load saved key and initialize UI
    const savedKey = loadApiKey();
    if (savedKey) {
        apiKeyInput.value = savedKey;
        rememberCheckbox.checked = true;
    }

    // Event handlers
    rememberCheckbox.addEventListener('change', () => {
        if (rememberCheckbox.checked && apiKeyInput.value) {
            saveApiKey(apiKeyInput.value);
        } else {
            clearApiKey();
        }
        populateModelSelect();
    });

    apiKeyInput.addEventListener('input', () => {
        if (rememberCheckbox.checked) {
            saveApiKey(apiKeyInput.value);
        }
        modelCache = {};
        populateModelSelect();
    });

    clearButton.addEventListener('click', () => {
        clearApiKey();
        apiKeyInput.value = '';
        rememberCheckbox.checked = false;
        populateModelSelect();
    });
	
	closeBtn.addEventListener('click', () => {
        modal.classList.remove('modal-visible');
    });

    // Close when clicking outside
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.classList.remove('modal-visible');
        }
    });

    // Download handler
    downloadBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const url = downloadBtn.dataset.downloadUrl;
        if (url) {
            const link = document.createElement('a');
            link.href = url;
            link.download = `generated-${Date.now()}.png`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        }
    });

    if (generateButton) {
        generateButton.addEventListener('click', runPrediction);
    }

    modelSelect.addEventListener("change", (e) => {
		handleModelChange(e);
		selectedModel = e.target.value;
		isUserSelection = false;
	});

    // Initial population with API key check
    function handleModelLoading() {
        if (!getApiKey()) {
            modelSelect.innerHTML = `
                <option value="" disabled selected>
                    Enter API key to load models
                </option>
            `;
            return;
        }
        populateModelSelect();
    }

    handleModelLoading();
});



