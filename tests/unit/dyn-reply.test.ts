import { describe, expect, it } from 'vitest';
import { toReply } from '../../src/content/api/dyn';

describe('动态评论用户资料', () => {
  it('读取等级、动态头像框、粉丝勋章和铭牌', () => {
    const reply = toReply({
      rpid: 42, mid: 8,
      member: {
        uname: '评论用户', avatar: '//i0.hdslb.com/face.jpg',
        level_info: { current_level: 6 }, is_senior_member: 1,
        pendant: { image: 'frame.png', image_enhance: 'animated.webp', image_enhance_frame: '//i0.hdslb.com/frame.png' },
        fans_detail: {
          medal_name: '映间', level: 18,
          medal_color: 0xfff8ebf0, medal_color_end: 0xfff6eddf, medal_color_border: 0xffefe3c7,
          medal_color_name: 0xffab6890, medal_color_level: 0xffd9a0b6,
          first_icon: '//i0.hdslb.com/first.png', second_icon: '//i0.hdslb.com/second.png',
        },
        nameplate: { name: '有爱大佬', image_small: '//i0.hdslb.com/plate.png' },
      },
      content: { message: '前排' },
    });
    expect(reply.level).toBe(6);
    expect(reply.senior).toBe(true);
    expect(reply.pendant).toBe('animated.webp');
    expect(reply.medal).toEqual({
      name: '映间', level: 18, color: '#f8ebf0ff', endColor: '#f6eddfff', borderColor: '#efe3c7ff',
      nameColor: '#ab6890ff', levelColor: '#d9a0b6ff',
      firstIcon: 'https://i0.hdslb.com/first.png', secondIcon: 'https://i0.hdslb.com/second.png',
    });
    expect(reply.nameplate).toEqual({ name: '有爱大佬', image: 'https://i0.hdslb.com/plate.png' });
  });

  it('没有装扮时不生成多余标记，非法等级不会溢出', () => {
    const reply = toReply({ rpid: 1, mid: 1, member: { uname: '普通用户', level_info: { current_level: 9 }, pendant: {}, fans_detail: null, nameplate: {} } });
    expect(reply.level).toBe(6);
    expect(reply.pendant).toBeUndefined();
    expect(reply.medal).toBeUndefined();
    expect(reply.nameplate).toBeUndefined();
    expect(toReply({ rpid: 2 }).level).toBe(0);
  });

  it('兼容旧版粉丝勋章颜色并过滤非法样式', () => {
    expect(toReply({ member: { fans_detail: { medal_name: '粉丝', medal_color: 15761546 } } }).medal?.color).toBe('#f0808a');
    expect(toReply({ member: { fans_detail: { medal_name: '粉丝', medal_color: '#52BF25' } } }).medal?.color).toBe('#52BF25');
    expect(toReply({ member: { fans_detail: { medal_name: '粉丝', medal_color: 'red; display:none' } } }).medal?.color).toBe('');
  });
});
