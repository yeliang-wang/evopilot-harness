package com.example;

import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.data.redis.connection.jedis.JedisConnectionFactory;
import org.springframework.data.redis.serializer.RedisSerializer;

public class RedisClientService {
  private RedisTemplate<String, String> redisTemplate;
  private JedisConnectionFactory connectionFactory;
  private RedisSerializer<String> serializer;
}
