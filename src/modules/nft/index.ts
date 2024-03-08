/* eslint-disable prefer-destructuring */
import { BaseModule } from '../base-module';
import { MintRequest, ValidateTokenOwnershipResponse } from '../../types';
import { post } from '../../utils/rest';
import { createApiKeyMissingError, mintingError } from '../../core/sdk-exceptions';
import { isMintRequest } from '../../utils/type-guards';
import { ERC1155ContractABI, ERC721ContractABI } from './ownershipABIs';
import Web3 from 'web3';

const v1StartMint721Path = '/v1/admin/nft/mint/721_mint';
const v1StartMint1155Path = '/v1/admin/nft/mint/1155_mint';
const successStatus = 'ok';

export class NFTModule extends BaseModule {
  public async startMint721(contractId: string, quantity: number, destinationAddress: string): Promise<MintRequest> {
    if (!this.sdk.secretApiKey) throw createApiKeyMissingError();
    const body = {
      contract_id: contractId,
      quantity,
      destination_address: destinationAddress,
    };
    const response = await post(`${this.sdk.apiBaseUrl}${v1StartMint721Path}`, this.sdk.secretApiKey, body, {
      'Content-Type': 'application/json',
    });
    if (!isMintRequest(response) || response.status !== successStatus) throw mintingError();
    const request: MintRequest = response;
    return request;
  }

  public async startMint1155(
    contractId: string,
    quantity: number,
    destinationAddress: string,
    tokenId: number,
  ): Promise<MintRequest> {
    if (!this.sdk.secretApiKey) throw createApiKeyMissingError();
    const body = {
      contract_id: contractId,
      quantity,
      destination_address: destinationAddress,
      token_id: tokenId,
    };
    const response = await post(`${this.sdk.apiBaseUrl}${v1StartMint1155Path}`, this.sdk.secretApiKey, body, {
      'Content-Type': 'application/json',
    });
    if (!isMintRequest(response) || response.status !== successStatus) throw mintingError();
    const request: MintRequest = response;
    return request;
  }

  // Token Gating function validates user ownership of wallet + NFT
  public async validateTokenOwnership(
    didToken: string,
    contractAddress: string,
    contractType: 'ERC721' | 'ERC1155',
    web3: Web3,
    tokenId?: string,
  ): Promise<ValidateTokenOwnershipResponse> {
    // Make sure ERC1155 has a tokenId
    if (contractType === 'ERC1155' && !tokenId) {
      throw new Error('ERC1155 requires a tokenId');
    }
    // Call magic and validate DID token
    try {
      await this.sdk.token.validate(didToken);
    } catch (e) {
      // Check if code is malformed token
      if ((e as any).code === 'ERROR_MALFORMED_TOKEN') {
        return {
          valid: false,
          error_code: 'UNAUTHORIZED',
          message: 'Invalid DID token: ERROR_MALFORMED_TOKEN',
        };
      }
      throw new Error((e as any).code);
    }
    const { email, publicAddress: walletAddress } = await this.sdk.users.getMetadataByToken(didToken);
    if (!email || !walletAddress) {
      return {
        valid: false,
        error_code: 'UNAUTHORIZED',
        message: 'Invalid DID token. May be expired or malformed.',
      };
    }

    // Check on-chain if user owns NFT by calling contract with web3
    let balance = BigInt(0);
    if (contractType === 'ERC721') {
      const contract = new web3.eth.Contract(ERC721ContractABI, contractAddress);
      balance = BigInt(await contract.methods.balanceOf(walletAddress).call())
    } else {
      const contract = new web3.eth.Contract(ERC1155ContractABI, contractAddress);
      balance = BigInt(await contract.methods.balanceOf(walletAddress, tokenId).call());
    }
    if (balance > BigInt(0)) {
      return {
        valid: true,
        error_code: '',
        message: '',
      };
    }
    return {
      valid: false,
      error_code: 'NO_OWNERSHIP',
      message: 'User does not own this token.',
    };
  }
}
