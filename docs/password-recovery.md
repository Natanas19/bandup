# Recuperação de senha

O fluxo exige configuração por ambiente antes da publicação. Na Vercel, defina
`NEXT_PUBLIC_SITE_URL` como a origem HTTPS exata que serve o BandUp, sem caminho.
Para testar em Preview, use uma origem controlada, com o projeto Supabase correto
e acesso à rota pelo destinatário do e-mail. Em desenvolvimento local, sem essa
variável, o fluxo aceita apenas localhost e endereços de loopback.

Em Authentication → URL Configuration do projeto Supabase correspondente,
confirme a Site URL e inclua explicitamente a URL completa da rota
`/redefinir-senha` na lista de Redirect URLs. Preserve as URLs do cadastro.
Somente no template **Reset password**, use um link deste formato:

```html
<a href="{{ .RedirectTo }}#token_hash={{ .TokenHash }}">Redefinir minha senha</a>
```

`.RedirectTo` já inclui `/redefinir-senha`. O fragmento mantém o token fora da
requisição inicial à Vercel. Desative o rastreamento de links no provedor de
e-mail ou confirme que ele preserva o fragmento e não divulga o token.
O template padrão baseado em `.ConfirmationURL` não é compatível com este fluxo.
Confirme SMTP, limites de envio e política de senha no projeto correspondente.

Valide com uma conta de teste, incluindo abertura em outro dispositivo,
link expirado ou reutilizado, e-mail desconhecido e navegador já autenticado
com outra conta. Use ambientes autorizados para o envio real.
