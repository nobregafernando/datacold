import 'package:flutter/material.dart';

import '../shared/widgets/stub_screen.dart';

// =================================================================
// Telas placeholder — desenho consistente, navegáveis. Serão
// substituídas pelas telas reais nas próximas fases.
// =================================================================

class SalaControleStub extends StatelessWidget {
  const SalaControleStub({super.key});
  @override
  Widget build(BuildContext context) => const StubScreen(
        titulo: 'Sala de Controle',
        descricao: 'Simulador de falhas em tempo real. Use os botões pra injetar incidentes (gap, spike, drift, offline, leitura corrompida) em qualquer sensor e ver o efeito na cadeia inteira.',
        icone: Icons.tune_rounded,
        corIcone: Color(0xFFD97706),
        checklist: [
          'Lista paginada de sensores com busca e abas por tipo',
          'Botões pré-configurados de falha por tipo (energia/temp/porta)',
          'Banner pulsante mostrando incidentes ativos',
          'Botão "Reativar internet / Cancelar pico / Restaurar leitura" colorido por tipo',
          'Atualização a cada 5s via Supabase Realtime',
        ],
      );
}

class AmbientesStub extends StatelessWidget {
  const AmbientesStub({super.key});
  @override
  Widget build(BuildContext context) => const StubScreen(
        titulo: 'Ambientes',
        descricao: 'Os 6 ambientes da planta — extrusão, câmara de congelados, câmara de estoque, graxaria e os dois ambientes externos. Cada um agrupa seus próprios sensores.',
        icone: Icons.factory_rounded,
        corIcone: Color(0xFF1F7A3A),
        checklist: [
          'Card por ambiente com ícone e cor própria',
          'Contagem de sensores e estado de saúde geral',
          'Drill-down pra ver os sensores daquele ambiente',
          'Mapa abstrato da planta (opcional)',
        ],
      );
}

class NotificacoesStub extends StatelessWidget {
  const NotificacoesStub({super.key});
  @override
  Widget build(BuildContext context) => const StubScreen(
        titulo: 'Notificações',
        descricao: 'Tudo o que os 4 agentes (energia, temperatura, porta, reconstrutor) detectam em tempo real. Veredictos crítico/atenção viram notificação automática.',
        icone: Icons.notifications_rounded,
        corIcone: Color(0xFF1E6FD6),
        checklist: [
          '6 KPIs no topo (total, críticas, atenção, médias, comuns, não lidas)',
          'Abas: Ativas agora / Catálogo completo / Histórico',
          'Item com faixa lateral colorida por severidade',
          'Push notifications nativas via Firebase Messaging',
        ],
      );
}

class AgentesStub extends StatelessWidget {
  const AgentesStub({super.key});
  @override
  Widget build(BuildContext context) => const StubScreen(
        titulo: 'Agentes',
        descricao: 'Os 4 agentes que cuidam de cada tipo de sensor. Cada agente tem regras (verifs com status crit/warn/info/ok) e parâmetros configuráveis por sensor.',
        icone: Icons.smart_toy_rounded,
        corIcone: Color(0xFF6B3EB8),
        checklist: [
          'Card grande por agente (energia/temperatura/porta/reconstrutor)',
          'Lista de regras com categoria, label e severidades possíveis',
          'Parâmetros editáveis com modal — salva via RPC atualizar_parametros_sensor',
          'Origem de cada limite citado (ANEEL, NEMA, ANVISA, Codex)',
        ],
      );
}

class PrototipoStub extends StatelessWidget {
  const PrototipoStub({super.key});
  @override
  Widget build(BuildContext context) => const StubScreen(
        titulo: 'Protótipo de arquitetura',
        descricao: 'Diagrama ponta-a-ponta — do equipamento da fábrica até o app, com resiliência contra queda de internet via MQTT + fila/buffer local + sincronização automática.',
        icone: Icons.account_tree_rounded,
        corIcone: Color(0xFF0E8A96),
        checklist: [
          'Diagrama em 5 colunas (Fábrica · Rede local · Resiliência/MQTT · Nuvem · Acesso)',
          '9 blocos numerados conectados por setas coloridas',
          'Seção explicando reconexão automática (onde mora)',
          'Seção explicando fila/buffer local',
        ],
      );
}

class ApresentacaoStub extends StatelessWidget {
  const ApresentacaoStub({super.key});
  @override
  Widget build(BuildContext context) => const StubScreen(
        titulo: 'Apresentação',
        descricao: 'Versão pitch do DataCold — slides com os números, capacidades e diferenciais da plataforma.',
        icone: Icons.slideshow_rounded,
        corIcone: Color(0xFF7C3AED),
        checklist: [
          'Slides navegáveis com swipe',
          'Animações de entrada por slide',
          'Modo fullscreen pra apresentar',
        ],
      );
}

class UsuariosStub extends StatelessWidget {
  const UsuariosStub({super.key});
  @override
  Widget build(BuildContext context) => const StubScreen(
        titulo: 'Usuários',
        descricao: 'Gestão de quem acessa a plataforma. Admin pode criar contas, atribuir papel (operador/admin) e desativar.',
        icone: Icons.group_rounded,
        corIcone: Color(0xFF1E6FD6),
        checklist: [
          'Lista de usuários com email, papel e último acesso',
          'Criar nova conta (signup via Supabase Auth)',
          'Mudar papel admin ⇄ operador',
          'Desativar usuário',
        ],
      );
}

class ContaStub extends StatelessWidget {
  const ContaStub({super.key});
  @override
  Widget build(BuildContext context) => const StubScreen(
        titulo: 'Minha conta',
        descricao: 'Seus dados, papel e ferramentas pra trocar senha ou sair.',
        icone: Icons.account_circle_rounded,
        corIcone: Color(0xFF1E6FD6),
        checklist: [
          'Card com avatar, nome, email e papel',
          'Botão "Trocar senha" (fluxo Supabase)',
          'Botão "Sair" (logout)',
          'Preferências (tema claro/escuro, idioma)',
        ],
      );
}

class SensorDetalheStub extends StatelessWidget {
  const SensorDetalheStub({super.key, required this.sensorId});
  final String sensorId;
  @override
  Widget build(BuildContext context) => StubScreen(
        titulo: 'Sensor · $sensorId',
        descricao: 'Detalhe ao vivo do sensor com banner de saúde, KPIs, gráficos em tempo real, faixa de incidentes ativos e análise dos agentes.',
        icone: Icons.sensors_rounded,
        corIcone: const Color(0xFF1E6FD6),
        checklist: const [
          'Banner lúdico colorido por severidade (verde/amarelo/laranja/vermelho)',
          'Velocímetros (energia) · termômetro (temperatura) · porta aberta/fechada',
          '4 KPIs calculados (potência média, energia, FP composto, %CUB)',
          'Gráficos fl_chart em tempo real com seletor de janela (5m/15m/30m/1h/6h/24h/3d/7d)',
          'Linha vermelha pontilhada no zero durante gap ativo',
          'Linha roxa tracejada quando reconstrutor preencheu lacuna',
          'Faixa de incidentes ativos com botão "Reativar internet" etc.',
          'Análise automática dos agentes com chips de cada verificação',
        ],
      );
}
