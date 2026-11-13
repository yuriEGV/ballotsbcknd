# Guía de Despliegue Web3 y Parches para Frontend (`ballotsfrntnd`)

## 1. Despliegue del Smart Contract (`BallotsRegistry.sol`)

1. Genera/elige una wallet dedicada para el Relayer del backend (con saldo en POL/ETH de testnet o mainnet).
2. En `.env` (local para desplegar, **nunca** lo subas a Git):
   ```env
   WEB3_RPC_URL=https://polygon-amoy-bor-rpc.publicnode.com
   WEB3_PRIVATE_KEY=0xTU_PRIVATE_KEY_RELAYER
   WEB3_CHAIN_ID=80002
   WEB3_NETWORK_NAME=Polygon Amoy
   ```
   *(Para producción puedes usar Polygon PoS `chainId: 137` o Base `chainId: 8453` con su RPC de Alchemy/Infura/QuickNode).*
3. Compila y despliega el contrato:
   ```bash
   npm run contract:compile
   npm run contract:deploy
   ```
4. Copia el `WEB3_CONTRACT_ADDRESS` impreso y configura en **Vercel (Backend -> Settings -> Environment Variables)**:
   - `WEB3_RPC_URL`
   - `WEB3_PRIVATE_KEY`
   - `WEB3_CONTRACT_ADDRESS`
   - `WEB3_CHAIN_ID`
   - `WEB3_NETWORK_NAME`
   - `WEB3_STRICT_MODE=true` *(exige que cada voto quede anclado en blockchain)*
   - `BALLOT_HMAC_SECRET` *(secreto aleatorio de 32+ bytes para nullifiers anónimos)*
   - `JWT_SECRET`
   - `MERCADOPAGO_WEBHOOK_SECRET` *(opcional, recomendado para verificar firma HMAC de webhooks)*

## 2. Parches incluidos para `ballotsfrntnd`

Copia los archivos de esta carpeta sobre el repositorio `ballotsfrntnd` (respetando la misma ruta relativa):

- `vercel.json`: Habilita rewrites SPA para que `/vote/:electionId` y `/booth/:electionId` no devuelvan 404 al abrirse directamente en Vercel.
- `src/pages/VotingBooth.jsx`:
  - Corrige la importación faltante de `XCircle` (evita crash en ejecución en la cabina de votación).
  - Muestra el comprobante criptográfico Web3 (`ballotCommitment`, `txHash`, enlace directo al explorador Polygonscan/Basescan).
  - Muestra la ponderación del votante cuando aplica.
- `src/pages/VotingGateway.jsx`:
  - Agrega soporte para verificación 2FA por clave de 6 dígitos (`requireVotingKey`) enviada al correo.
- `src/pages/ClientDashboard.jsx`:
  - Reemplaza el estado fijo `"ÍNTEGRO"` por validación real de `auditLog.chainIntegrity`, `onChain`, `tallyRoot` y enlaces `txHash` por voto.
  - Agrega switch `Doble Factor por Correo` en Configuración de la elección.
- `src/pages/AdminDashboard.jsx`:
  - Muestra verificación real `chainIntegrity`, datos del Smart Contract (`contractAddress`, `chainTip`) y enlaces al explorador blockchain por cada voto.

