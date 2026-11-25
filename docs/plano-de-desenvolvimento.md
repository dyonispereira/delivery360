# Plano de desenvolvimento

O plano completo (arquitetura, módulos, plano de contas, fluxo do pedido, entregas, modelo de dados e sprints)
está no documento do projeto: https://claude.ai/artifact/X3CCxW1jJjsuKeHbmLjdNv

## Sprints (2 semanas cada)

| Sprint | Entrega |
| --- | --- |
| 0 | Fundação: monorepo, login, restaurantes, módulos, permissões, painel admin |
| 1 e 2 | Loja online: vitrine, adicionais, carrinho, pagamento PIX e cartão, acompanhamento do pedido |
| 3 | Operação: painel de pedidos, impressão térmica, tela da cozinha, status |
| 4 e 5 | Entregas: motoboys, despacho, lotes, app do entregador, código de 4 dígitos |
| 6 e 7 | Gestão I: funcionários, plano de contas, contas a pagar e receber |
| 8 e 9 | Gestão II: escala, folgas, folha gerencial, fluxo de caixa, DRE; app do gerente |
| 10+ | Tráfego, integrações (Meta, Google, iFood, OFX), estoque e fichas técnicas |

## Regras de arquitetura

- Toda tabela de negócio tem `tenant_id`; toda rota de módulo usa `@RequireModule('<codigo>')`.
- Módulos não importam uns aos outros: conversam por eventos (`EventsService.publish`, tabela `domain_events`).
- Alterações feitas pela equipe ou pelo restaurante passam pelo `AuditService`.
