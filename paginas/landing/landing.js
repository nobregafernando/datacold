/**
 * Landing — classe que orquestra animações e chamadas leves da landing page.
 * Mantida bem enxuta: só ativa o "selo de status" pingando na API e anima entradas.
 */
class Landing {
  constructor() {
    this.api = new ApiBEM();
    this.seloStatus = document.querySelector("[data-status-api]");
    this.numerosAnimados = document.querySelectorAll("[data-contador]");
  }

  iniciar() {
    this._verificarStatusApi();
    this._observarSurgimentos();
    this._animarContadores();
  }

  async _verificarStatusApi() {
    if (!this.seloStatus) return;
    try {
      const saude = await this.api.verificarSaude();
      const texto = saude.demo_mode ? "API · modo demo" : "API · dados reais";
      this.seloStatus.querySelector("[data-status-texto]").textContent = texto;
      this.seloStatus.classList.add("online");
    } catch {
      this.seloStatus.querySelector("[data-status-texto]").textContent = "API offline";
      this.seloStatus.classList.add("offline");
    }
  }

  _observarSurgimentos() {
    const alvos = document.querySelectorAll("[data-aparece]");
    if (!("IntersectionObserver" in window)) {
      alvos.forEach(el => el.classList.add("surgir"));
      return;
    }
    const io = new IntersectionObserver((entradas) => {
      entradas.forEach(e => {
        if (e.isIntersecting) {
          e.target.classList.add("surgir");
          io.unobserve(e.target);
        }
      });
    }, { threshold: 0.15 });
    alvos.forEach(el => io.observe(el));
  }

  _animarContadores() {
    if (!this.numerosAnimados.length) return;
    const animar = (el) => {
      const alvo = parseFloat(el.dataset.contador);
      const sufixo = el.dataset.sufixo || "";
      const duracao = 1400;
      const inicio = performance.now();
      const passo = (agora) => {
        const t = Math.min((agora - inicio) / duracao, 1);
        const ease = 1 - Math.pow(1 - t, 3);
        const valor = alvo * ease;
        el.textContent = (Number.isInteger(alvo) ? Math.floor(valor) : valor.toFixed(1)) + sufixo;
        if (t < 1) requestAnimationFrame(passo);
      };
      requestAnimationFrame(passo);
    };

    if (!("IntersectionObserver" in window)) {
      this.numerosAnimados.forEach(animar);
      return;
    }
    const io = new IntersectionObserver((entradas) => {
      entradas.forEach(e => {
        if (e.isIntersecting) {
          animar(e.target);
          io.unobserve(e.target);
        }
      });
    }, { threshold: 0.5 });
    this.numerosAnimados.forEach(el => io.observe(el));
  }
}

document.addEventListener("DOMContentLoaded", () => {
  new Landing().iniciar();
});
