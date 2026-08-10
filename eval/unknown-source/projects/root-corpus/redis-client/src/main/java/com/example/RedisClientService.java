package com.example;

import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.data.redis.connection.jedis.JedisConnectionFactory;

public class RedisClientService {
  RedisTemplate<String, String> template;
  JedisConnectionFactory factory;
}
