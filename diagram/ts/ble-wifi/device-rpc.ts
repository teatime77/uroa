/**
 * .protoから生成した機器RPCの公開型。契約の正本はdiagram/rpc/device.proto。
 * 通常指令はdevice-control.generated.ts、未移行の通信はdevice-connection.tsが既存処理へ接続する。
 * rpc-client.tsが経路・引数・同時数、control-connection.tsが経路の世代・ACK・待ち列を管理する。
 * 既存のパケット・認証・ACK・転送・通知・JPEGは変更しない。Python RemoteはBLEだけに対応する。
 */
import type { RpcClient } from "./rpc-client";
import type { DeviceRpcCalls, DeviceRpcSubscriptions } from "./device-rpc.generated";
export type { DeviceRpcCalls, DeviceRpcSubscriptions, RemoteRpcCalls } from "./device-rpc.generated";

/** 操作と購読は同じ接続の所有者を使う。通信を起こさない状態参照はDeviceConnectionに残す。 */
export type DeviceRpcClient = RpcClient<DeviceRpcCalls, DeviceRpcSubscriptions>;
