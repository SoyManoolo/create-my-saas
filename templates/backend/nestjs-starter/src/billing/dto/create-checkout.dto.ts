import { IsInt, IsNotEmpty, IsString, Max, Min } from 'class-validator';

export class CreateCheckoutDto {
  @IsString()
  @IsNotEmpty()
  priceId!: string;

  @IsInt()
  @Min(1)
  @Max(1000)
  quantity = 1;
}
