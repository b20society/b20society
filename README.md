## Foundry

**Foundry is a blazing fast, portable and modular toolkit for Ethereum application development written in Rust.**

Foundry consists of:

- **Forge**: Ethereum testing framework (like Truffle, Hardhat and DappTools).
- **Cast**: Swiss army knife for interacting with EVM smart contracts, sending transactions and getting chain data.
- **Anvil**: Local Ethereum node, akin to Ganache, Hardhat Network.
- **Chisel**: Fast, utilitarian, and verbose solidity REPL.

## Documentation

https://book.getfoundry.sh/

## Usage

### Build

```shell
$ forge build
```

### Test

```shell
$ forge test
```

### Format

```shell
$ forge fmt
```

### Gas Snapshots

```shell
$ forge snapshot
```

### Anvil

```shell
$ anvil
```

### Deploy

```shell
$ forge script script/Counter.s.sol:CounterScript --rpc-url <your_rpc_url> --private-key <your_private_key>
```

### Cast

```shell
$ cast <subcommand>
```

### Help

```shell
$ forge --help
$ anvil --help
$ cast --help
```

## NFT Smart Contract

The NFT contract lives in `contracts/B20SocietyNFT.sol`. Key properties:

- **ERC-721 + ERC-2981** (OpenZeppelin v5)
- **Solidity 0.8.24**, optimizer enabled
- **Foundry** for build/test/deploy
- **1000 max supply**, **5 per wallet** cap, **0.001 ETH** mint price
- **Phases 1-10**, advanced by burning $SOCIETY
- **Linear burn curve**: 20K → 100K per advance
- **5% royalty** to immutable receiver
- **Fully decentralized**: no admin functions, immutable SOCIETY address

### Build & Test

```bash
# Install dependencies
forge install foundry-rs/forge-std
forge install OpenZeppelin/openzeppelin-contracts

# Compile
forge build

# Run tests (19 tests)
forge test

# Deploy
SOCIETY=<predicted_address> ROYALTY_RECEIVER=<recipient> \
  forge script script/Deploy.s.sol:Deploy \
    --rpc-url base --broadcast --private-key $PK
```

### Deployment Flow

1. Call o1 API `POST /v1/launches/prepare` → get predicted SOCIETY address
2. Run `Deploy.s.sol` with the predicted address
3. Broadcast the o1 launch transaction
4. Both contracts live on Base, no further setup needed
