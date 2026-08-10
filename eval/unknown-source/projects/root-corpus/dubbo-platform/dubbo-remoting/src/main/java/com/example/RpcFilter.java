package com.example;

import com.alibaba.dubbo.rpc.RpcContext;
import com.alibaba.dubbo.rpc.Invoker;

public class RpcFilter {
  RpcContext context;
  Invoker<?> invoker;
}
