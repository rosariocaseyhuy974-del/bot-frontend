// Финальный интерактивный холст WebApp конструктора v6.3 с изолированной матрицей жестов
(function () {
  const tg = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;
  if (tg) {
    tg.ready();
    tg.expand();
  }

  const canvas = document.getElementById("editorCanvas");
  const ctx = canvas.getContext("2d");
  const gestureLayer = document.getElementById("gestureLayer");
  const doneBtn = document.getElementById("doneBtn");
  const errorText = document.getElementById("errorText");

  // Извлечение контейнера горизонтальной ленты миниатюр
  const assetsScrollLane = document.getElementById("assetsScrollLane");
  const customItemInput = document.getElementById("customItemInput");

  const params = new URLSearchParams(window.location.search);
  const sessionToken = params.get("token");

  // Базовый адрес туннеля, строго синхронизированный с config.py
  const BASE_API_URL = "https://tackle-unvisited-doorbell.ngrok-free.dev";

  let W = 1024;
  let H = 1024;
  canvas.width = W;
  canvas.height = H;

  // Изначальные эталонные координаты
  const state = {
    x: W / 2,
    y: H / 2,
    scale: 1.0,
    angle: 0,
  };

  const gestureStart = {
    x: state.x,
    y: state.y,
    scale: state.scale,
    angle: state.angle,
  };

  const images = {
    bg: null,
    item: null,
  };

  // Пакет гардеробной сессии под массив ассетов из бэкенда
  let globalAssetsPack = [];
  let currentAssetIndex = 0;

  function setError(msg) {
    errorText.textContent = msg || "";
  }

  function loadImage(base64Data) {
    return new Promise((resolve, reject) => {
      if (!base64Data) {
        reject(new Error("Поток Base64 пуст."));
        return;
      }
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Ошибка десериализации потока Base64."));
      img.src = base64Data;
    });
  }

  function draw() {
    if (!images.bg || !images.item) return;

    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(images.bg, 0, 0, W, H);

    const itemW = images.item.width;
    const itemH = images.item.height;

    ctx.save();
    // Математический перенос и отрисовка слоя Pillow
    ctx.translate(state.x, state.y);
    ctx.rotate((state.angle * Math.PI) / 180);
    ctx.scale(state.scale, state.scale);
    
    const aspect = itemW / itemH;
    let targetW = itemW;
    let targetH = itemH;
    
    if (itemW > itemH) {
      targetW = 358; 
      targetH = 358 / aspect;
    } else {
      targetH = 358;
      targetW = 358 * aspect;
    }
    
    ctx.drawImage(images.item, -targetW / 2, -targetH / 2, targetW, targetH);
    ctx.restore();
  }

  function constrainPosition() {
    if (!images.item) return;
    state.x = Math.min(W, Math.max(0, state.x));
    state.y = Math.min(H, Math.max(0, state.y));
  }

  let rafId = 0;
  function requestDraw() {
    if (rafId) return;
    rafId = requestAnimationFrame(() => {
      rafId = 0;
      draw();
    });
  }

  function clampScale(v) {
    return Math.min(8, Math.max(0.05, v));
  }

  function setupGestures() {
    if (!window.Hammer) {
      setError("Hammer.js не инициализирован.");
      return;
    }

    // Жесткая привязка touch-action для блокировки нативного скролла браузера
    gestureLayer.style.touchAction = "none";

    const manager = new Hammer.Manager(gestureLayer, {
      touchAction: 'none'
    });
    
    // Инициализируем распознаватели жестов
    const pan = new Hammer.Pan({ threshold: 0, pointers: 1 });
    const pinch = new Hammer.Pinch({ threshold: 0 });
    const rotate = new Hammer.Rotate({ threshold: 0 });

    // Настраиваем одновременное распознавание для двух пальцев
    pinch.recognizeWith(rotate);
    manager.add([pan, pinch, rotate]);

    // --- ЛОГИКА ПЕРЕМЕЩЕНИЯ (ОДИН ПАЛЕЦ) ---
    manager.on("panstart", () => {
      gestureStart.x = state.x;
      gestureStart.y = state.y;
    });

    manager.on("panmove", (e) => {
      const rect = canvas.getBoundingClientRect();
      const scaleX = W / rect.width;
      const scaleY = H / rect.height;

      state.x = gestureStart.x + (e.deltaX * scaleX);
      state.y = gestureStart.y + (e.deltaY * scaleY);
      
      constrainPosition();
      requestDraw();
    });

    // --- ЛОГИКА МАСШТАБИРОВАНИЯ (ДВА ПАЛЬЦА - ИЗОЛИРОВАННАЯ) ---
    manager.on("pinchstart", () => {
      gestureStart.scale = state.scale;
    });

    manager.on("pinchmove", (e) => {
      // 🛡 СУПЕР-ФИКС: Меняем только масштаб, координаты x и y остаются неприкосновенными!
      state.scale = clampScale(gestureStart.scale * e.scale);
      requestDraw();
    });

    // --- ЛОГИКА ВРАЩЕНИЯ (ДВА ПАЛЬЦА - ИЗОЛИРОВАННАЯ) ---
    manager.on("rotatestart", () => {
      gestureStart.angle = state.angle;
    });

    manager.on("rotatemove", (e) => {
      // 🛡 СУПЕР-ФИКС: Крутим строго вокруг собственной оси ассета, игнорируя динамический pivot Hammer.js
      state.angle = (gestureStart.angle + e.rotation) % 360;
      requestDraw();
    });
  }

  // Динамическая загрузка ассета по клику из горизонтальной ленты
  async function switchActiveAsset(index) {
    if (!globalAssetsPack || globalAssetsPack.length === 0) return;
    try {
      setError("Синхронизация предмета...");
      currentAssetIndex = index;
      
      const assetData = globalAssetsPack[index];
      const itemImg = await loadImage(assetData.b64);
      images.item = itemImg;

      // 🛡 UX-УЛУЧШЕНИЕ: Мы БОЛЬШЕ НЕ СБРАСЫВАЕМ координаты x, y и поворот в ноль, 
      // чтобы пользователь мог бесшовно примерять разные шляпы на одно и то же настроенное место.
      
      // Визуальная подсветка выбранной карточки на витрине
      document.querySelectorAll(".asset-card").forEach((card, i) => {
        if (i === index) card.classList.add("active");
        else card.classList.remove("active");
      });

      setError("");
      requestDraw();
    } catch (err) {
      setError("Ошибка переключения: " + err.message);
    }
  }

  // Генерация HTML-карточек предметов внутри горизонтального скролл-бара v6.0
  function buildWardrobeCarouselUI() {
    if (!assetsScrollLane) return;

    // Зачищаем старые карточки, оставляя только элемент добавления своего предмета
    const uploadWrapper = assetsScrollLane.querySelector(".upload-card-wrapper");
    assetsScrollLane.innerHTML = "";
    if (uploadWrapper) {
      assetsScrollLane.appendChild(uploadWrapper);
    }

    globalAssetsPack.forEach((asset, index) => {
      const card = document.createElement("div");
      card.className = "asset-card";
      if (index === currentAssetIndex) card.classList.add("active");

      const img = document.createElement("img");
      img.src = asset.b64;
      
      card.appendChild(img);
      
      card.onclick = () => {
        switchActiveAsset(index);
      };

      assetsScrollLane.appendChild(card);
    });
  }

  // Загрузчик «Своего предмета» (v6.0 Roadmap)
  function initCustomItemUploader() {
    if (!customItemInput) return;
    customItemInput.onchange = function (e) {
      const file = e.target.files[0];
      if (!file) return;

      setError("ИИ очищает фон ассета на CPU...");
      const reader = new FileReader();
      reader.onload = async function (evt) {
        const base64Raw = evt.target.result;
        try {
          const response = await fetch(`${BASE_API_URL}/upload_custom`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              token: sessionToken,
              image_b64: base64Raw
            })
          });

          if (!response.ok) throw new Error("ИИ не смог сегментировать объект.");
          const resData = await response.json();
          
          const newAsset = {
            path: resData.path,
            b64: resData.item_b64
          };
          
          globalAssetsPack.unshift(newAsset);
          buildWardrobeCarouselUI();
          await switchActiveAsset(0);
        } catch (err) {
          setError("Сбой ИИ-вырезки: " + err.message);
        }
      };
      reader.readAsDataURL(file);
    };
  }

  function initDoneButton() {
    doneBtn.onclick = async () => {
      doneBtn.disabled = true;
      setError("Запекание слоев на ИИ-холсте...");

      const currentAssetPath = globalAssetsPack[currentAssetIndex] ? globalAssetsPack[currentAssetIndex].path : "";

      const payload = {
        x: Math.round(state.x),
        y: Math.round(state.y),
        scale: Number(state.scale.toFixed(4)),
        angle: Math.round(state.angle),
        chosen_path: currentAssetPath
      };

      try {
        const response = await fetch(`${BASE_API_URL}/submit_coords`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "ngrok-skip-browser-warning": "true"
          },
          body: JSON.stringify({
            token: sessionToken,
            coords: payload
          })
        });

        if (response.ok) {
          setError("");
          if (tg && typeof tg.close === "function") {
            tg.close();
          }
        } else {
          const errData = await response.json();
          throw new Error(errData.error || "Ошибка шлюза СУБД.");
        }
      } catch (err) {
        doneBtn.disabled = false;
        setError("Ошибка передачи: " + err.message);
      }
    };
  }

  async function init() {
    if (!sessionToken) {
      setError("Критическая ошибка: токен сессии WebApp пуст.");
      return;
    }

    try {
      setError("Синхронизация сессии ИИ-станка...");
      
      const response = await fetch(`${BASE_API_URL}/get_state`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "ngrok-skip-browser-warning": "true"
        },
        body: JSON.stringify({ token: sessionToken })
      });

      if (!response.ok) {
        throw new Error("Сервер вернул ошибку авторизации сессии.");
      }

      const storeData = await response.json();
      
      globalAssetsPack = storeData.assets_pack || [];
      if (globalAssetsPack.length === 0) {
        throw new Error("ИИ-витрина этой категории пуста. Добавьте модели через /admin.");
      }

      const [bgImg, itemImg] = await Promise.all([
        loadImage(storeData.bg),
        loadImage(globalAssetsPack[0].b64)
      ]);

      images.bg = bgImg;
      images.item = itemImg;

      // Первичная центровка
      state.x = W / 2;
      state.y = H / 2;
      state.angle = 0;

      const maxStartSize = W * 0.35;
      const fitScale = maxStartSize / Math.max(itemImg.width, itemImg.height);
      state.scale = clampScale(fitScale);

      setupGestures();
      buildWardrobeCarouselUI();
      initCustomItemUploader();
      initDoneButton();

      doneBtn.disabled = false;
      setError("");
      requestDraw();
    } catch (err) {
      setError(err.message || "Ошибка построения холста.");
    }
  }

  init();
})();