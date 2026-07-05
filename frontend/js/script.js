import { cropImage, sendImage } from "./api.js";


// Gérer le titre de la page en fonction de la taille
function updateHeaderTitle(){
    const title = document.getElementById("title");

    if (window.innerWidth <  490){
        title.textContent = "X-Diag";
    } else {
        title.textContent = "Assistant X-Diag";
    }
}

updateHeaderTitle();
window.addEventListener("resize", updateHeaderTitle);


// Drag&Drop
const dropZone = document.getElementById("drop-zone");
const fileInput = document.getElementById("file-input");
const previewFront = document.getElementById("preview-front");

dropZone.addEventListener("click", () => {
    fileInput.click();
});

fileInput.addEventListener("change", async (e) => {
    const file = e.target.files[0];

    if (!file) return;

    const blob = await cropImage(file);
    const url = URL.createObjectURL(blob);

    previewFront.src = url;
    previewFront.style.display = "block";

    const data = await sendImage(file);
    console.log(data);
});

dropZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropZone.classList.add("dragover");
});

dropZone.addEventListener("dragleave", () => {
    dropZone.classList.remove("dragover");
});

dropZone.addEventListener("drop", async (e) => {
    e.preventDefault();
    dropZone.classList.remove("dragover");

    const file = e.dataTransfer.files[0];

    if (!file) return;

    fileInput.files = e.dataTransfer.files;

    try {
        const blob = await cropImage(file);
        const url = URL.createObjectURL(blob);

        previewFront.src = url;
        previewFront.style.display = "block";

        const data = await sendImage(file);
        console.log(data);
    } catch (e) {
        console.error("Erreur lors du traitement de l'image :", e);
    }

});

function showImage(file) {
    if (!file || !file.type.startsWith("image/")) return;

    const reader = new FileReader();

    reader.onload = (e) => {
        previewFront.src = e.target.result;
        previewFront.style.display = "block";
    }

    reader.readAsDataURL(file);
}


// Ignorer le champ AP/PA en cas de radio latérale
const frontale = document.getElementById("frontale");
const laterale = document.getElementById("laterale");

const ap = document.getElementById("ap");
const pa = document.getElementById("pa");

const apLabel = document.querySelector("label[for='ap']");
const paLabel = document.querySelector("label[for='pa']");
const directionRadios = [ap, pa];

function updateDirectionState() {
    if (laterale.checked) {
        directionRadios.forEach(r => {
            r.checked = false;
            r.disabled = true;
        });
        apLabel.style.color = "#777777";
        paLabel.style.color = "#777777";
    } else {
        directionRadios.forEach(r => {
            r.disabled = false;
        });
        apLabel.style.color = "";
        paLabel.style.color = "";
    }
}

frontale.addEventListener("change", updateDirectionState);
laterale.addEventListener("change", updateDirectionState);


// Reset du form
const resetButton = document.getElementById("reset");
resetButton.addEventListener("click", () => {
    document.getElementById("age").value = "";
    document.getElementById("sex").selectedIndex = 0;

    frontale.checked = false;
    laterale.checked = false;

    directionRadios.forEach(r => {
        r.checked = false;
        r.disabled = false;
    });

    apLabel.style.color = "";
    paLabel.style.color = "";
})


// Gestion d'erreur formulaire incomplet
const analyseButton = document.getElementById("analyse");
const errorMessage = document.getElementById("error_message");

analyseButton.addEventListener("click", (e) => {
    e.preventDefault();

    errorMessage.textContent = "";

    const image = document.getElementById("file-input").files;
    const patientAge = document.getElementById("age").value.trim();
    const patientSex = document.getElementById("sex").value;
    const orientation = document.querySelector("input[name='orientation']:checked");
    const direction = document.querySelector("input[name='direction']:checked");

    const errors = [];

    if (image.length === 0) {
        errors.push("Veuillez sélectionner une radiographie");
    }

    if (patientAge === "" || patientSex === "" || !orientation || !direction) {
        errors.push("Veuillez remplir tous les champs");
    }

    if (errors.length > 0) {
        errorMessage.textContent = errors.join(". ");
        return;
    }

    console.log("Formulaire valide !");
    analyseButton.disabled = true;
    resetButton.disabled = true;
    analyseButton.textContent = "Analyse...";
});

// Retournement de la carte
document.querySelector(".flip-card").addEventListener("click", function() {
    this.classList.toggle("flipped");
})